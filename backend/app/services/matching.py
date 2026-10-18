"""Nearby-driver search, surge pricing and promo logic."""
import math
import random
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..config import settings
from ..database import is_postgres
from ..models import Driver, Promo, Ride, RideStatus
from .maps import haversine


def nearby_drivers(
    db: Session,
    lat: float,
    lng: float,
    radius_m: float = 5000,
    vehicle_type: str | None = None,
    statuses: tuple[str, ...] = ("online",),
    limit: int = 30,
) -> list[tuple[Driver, float]]:
    """Return [(driver, distance_m)] sorted by distance.

    On Postgres+PostGIS this uses ST_DWithin on geography (index friendly);
    otherwise a bounding-box SQL prefilter + exact haversine in Python.
    """
    if settings.USE_POSTGIS and is_postgres():
        sql = text(
            """
            SELECT user_id, ST_Distance(
                ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS dist
            FROM drivers
            WHERE status = ANY(:statuses) AND lat IS NOT NULL
              AND (CAST(:vt AS VARCHAR) IS NULL OR vehicle_type = CAST(:vt AS VARCHAR))
              AND ST_DWithin(ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography,
                             ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :radius)
            ORDER BY dist LIMIT :limit
            """
        )
        rows = db.execute(
            sql,
            {"lat": lat, "lng": lng, "radius": radius_m, "vt": vehicle_type,
             "statuses": list(statuses), "limit": limit},
        ).all()
        drivers = {d.user_id: d for d in db.scalars(select(Driver).where(Driver.user_id.in_([r[0] for r in rows])))}
        return [(drivers[r[0]], float(r[1])) for r in rows if r[0] in drivers]

    dlat = radius_m / 111_000
    dlng = radius_m / (111_000 * max(math.cos(math.radians(lat)), 0.01))
    q = select(Driver).where(
        Driver.status.in_(statuses),
        Driver.lat.between(lat - dlat, lat + dlat),
        Driver.lng.between(lng - dlng, lng + dlng),
    )
    if vehicle_type:
        q = q.where(Driver.vehicle_type == vehicle_type)
    out = []
    for d in db.scalars(q):
        dist = haversine(lat, lng, d.lat, d.lng)
        if dist <= radius_m:
            out.append((d, dist))
    out.sort(key=lambda x: x[1])
    return out[:limit]


def ensure_demo_drivers_near(db: Session, lat: float, lng: float) -> None:
    """Demo mode: if few drivers are around, move idle bot drivers near the given point
    so a solo demo works in any city."""
    if not settings.DEMO_BOTS:
        return
    near = nearby_drivers(db, lat, lng, 4000)
    have = {d.vehicle_type for d, _ in near}
    idle = list(db.scalars(select(Driver).where(Driver.is_bot.is_(True), Driver.status == "online")))
    idle = [d for d in idle if haversine(lat, lng, d.lat or 0, d.lng or 0) > 4000]
    random.shuffle(idle)
    moved = 0
    for d in idle:
        if len(near) + moved >= 8 and d.vehicle_type in have:
            continue
        r = random.uniform(300, 2500)
        ang = random.uniform(0, 2 * math.pi)
        d.lat = lat + (r * math.cos(ang)) / 111_000
        d.lng = lng + (r * math.sin(ang)) / (111_000 * math.cos(math.radians(lat)))
        d.location_updated_at = datetime.now(timezone.utc)
        have.add(d.vehicle_type)
        moved += 1
        if moved >= 10:
            break
    if moved:
        db.commit()


def surge_multiplier(db: Session, lat: float, lng: float) -> float:
    """Simple demand/supply surge: open requests nearby vs online drivers nearby."""
    supply = len(nearby_drivers(db, lat, lng, 3000))
    dlat = 3000 / 111_000
    demand = db.scalar(
        select(func.count(Ride.id)).where(
            Ride.status == RideStatus.REQUESTED,
            Ride.pickup_lat.between(lat - dlat, lat + dlat),
            Ride.pickup_lng.between(lng - dlat, lng + dlat),
        )
    ) or 0
    if supply == 0:
        return 1.5
    ratio = demand / supply
    if ratio > 1.5:
        return 1.8
    if ratio > 1:
        return 1.4
    if ratio > 0.6:
        return 1.2
    return 1.0


def apply_promo(db: Session, code: str | None, fare: float) -> tuple[float, str]:
    """Returns (discount, message). discount == 0 means not applied."""
    if not code:
        return 0.0, ""
    promo = db.scalar(select(Promo).where(Promo.code == code.strip().upper()))
    if not promo or not promo.active:
        return 0.0, "Invalid promo code"
    now = datetime.now(timezone.utc)
    exp = promo.expires_at
    if exp is not None and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < now:
        return 0.0, "This promo code has expired"
    if promo.usage_limit is not None and promo.used_count >= promo.usage_limit:
        return 0.0, "Promo usage limit reached"
    if fare < promo.min_fare:
        return 0.0, f"Valid on fares above ₹{promo.min_fare:.0f}"
    if promo.discount_type == "percent":
        disc = fare * promo.value / 100
        if promo.max_discount:
            disc = min(disc, promo.max_discount)
    else:
        disc = promo.value
    disc = round(min(disc, fare - 1))
    return float(disc), f"{promo.code} applied – you save ₹{disc:.0f}"
