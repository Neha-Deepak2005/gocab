from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Driver, Ride, RideDecline, RideStatus, User, WalletTransaction
from ..schemas import DriverOut, DriverStatusIn, LatLng
from ..security import get_current_user, get_driver
from ..services import rides as ride_svc
from ..services.maps import haversine
from ..services.matching import ensure_demo_drivers_near, nearby_drivers
from ..services.realtime import hub

router = APIRouter(prefix="/api/drivers", tags=["drivers"])


def _driver(db: Session, user: User) -> Driver:
    d = db.get(Driver, user.id)
    if not d:
        raise HTTPException(400, "Driver profile missing")
    return d


@router.get("/me", response_model=DriverOut)
def my_driver(user: User = Depends(get_driver), db: Session = Depends(get_db)):
    return _driver(db, user)


@router.post("/status", response_model=DriverOut)
def set_status(data: DriverStatusIn, user: User = Depends(get_driver), db: Session = Depends(get_db)):
    d = _driver(db, user)
    if d.status == "on_trip" and data.status == "offline":
        raise HTTPException(409, "Finish your current trip before going offline")
    if data.lat is not None and data.lng is not None:
        d.lat, d.lng = data.lat, data.lng
        d.location_updated_at = datetime.now(timezone.utc)
    if data.status == "online" and d.lat is None:
        raise HTTPException(422, "Share your location to go online")
    if d.status != "on_trip":
        d.status = data.status
    db.commit()
    return d


@router.post("/location", response_model=DriverOut)
def update_location(data: LatLng, user: User = Depends(get_driver), db: Session = Depends(get_db)):
    """REST alternative to sending {"type":"location"} over the driver websocket."""
    d = _driver(db, user)
    d.lat, d.lng = data.lat, data.lng
    d.location_updated_at = datetime.now(timezone.utc)
    db.commit()
    relay_location(db, user.id, data.lat, data.lng)
    return d


def relay_location(db: Session, driver_id: int, lat: float, lng: float) -> None:
    ride = db.scalar(select(Ride).where(Ride.driver_id == driver_id, Ride.status.in_(RideStatus.ACTIVE)))
    if ride:
        tgt = (ride.pickup_lat, ride.pickup_lng) if ride.status in (RideStatus.ACCEPTED, RideStatus.ARRIVED) \
            else (ride.drop_lat, ride.drop_lng)
        eta = int(haversine(lat, lng, *tgt) * 1.3 / 7.5)
        hub.notify(ride.rider_id, {"type": "driver_location", "ride_id": ride.id, "lat": lat, "lng": lng, "eta_secs": eta})


@router.get("/requests")
def open_requests(user: User = Depends(get_driver), db: Session = Depends(get_db)):
    """Open ride requests near the driver that they haven't declined."""
    d = _driver(db, user)
    if d.lat is None or d.status != "online":
        return []
    declined = set(db.scalars(select(RideDecline.ride_id).where(RideDecline.driver_id == user.id)))
    dlat = ride_svc.MATCH_RADIUS_M / 111_000
    rides = db.scalars(select(Ride).where(
        Ride.status == RideStatus.REQUESTED, Ride.vehicle_type == d.vehicle_type,
        Ride.pickup_lat.between(d.lat - dlat, d.lat + dlat),
        Ride.pickup_lng.between(d.lng - dlat * 1.2, d.lng + dlat * 1.2),
    ).order_by(Ride.created_at.desc()).limit(20))
    out = []
    for r in rides:
        if r.id in declined:
            continue
        dist = haversine(d.lat, d.lng, r.pickup_lat, r.pickup_lng)
        if dist <= ride_svc.MATCH_RADIUS_M:
            item = ride_svc.serialize(r, user, db)
            item["pickup_distance_m"] = int(dist)
            out.append(item)
    return out


@router.get("/nearby")
def nearby(lat: float = Query(ge=-90, le=90), lng: float = Query(ge=-180, le=180), radius: int = Query(4000, le=20000),
           vehicle_type: str | None = None, _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Online drivers around a point (shown as cars on the rider's map)."""
    ensure_demo_drivers_near(db, lat, lng)
    return [{"id": d.user_id, "lat": d.lat, "lng": d.lng, "vehicle_type": d.vehicle_type,
             "distance_m": int(dist)} for d, dist in nearby_drivers(db, lat, lng, radius, vehicle_type)]


@router.get("/stats")
def stats(user: User = Depends(get_driver), db: Session = Depends(get_db)):
    """Earnings and trip stats for the driver dashboard."""
    now = datetime.now(timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week = today - timedelta(days=6)

    def earned(since):
        return round(db.scalar(select(func.coalesce(func.sum(WalletTransaction.amount), 0)).where(
            WalletTransaction.user_id == user.id, WalletTransaction.kind == "earning",
            WalletTransaction.created_at >= since)) or 0, 2)

    completed = select(func.count(Ride.id)).where(Ride.driver_id == user.id, Ride.status == RideStatus.COMPLETED)
    daily = []
    for i in range(6, -1, -1):
        start = today - timedelta(days=i)
        amt = db.scalar(select(func.coalesce(func.sum(WalletTransaction.amount), 0)).where(
            WalletTransaction.user_id == user.id, WalletTransaction.kind == "earning",
            WalletTransaction.created_at >= start, WalletTransaction.created_at < start + timedelta(days=1))) or 0
        daily.append({"day": start.strftime("%a"), "amount": round(amt, 2)})
    dist = db.scalar(select(func.coalesce(func.sum(Ride.distance_meters), 0)).where(
        Ride.driver_id == user.id, Ride.status == RideStatus.COMPLETED)) or 0
    return {
        "today": earned(today), "week": earned(week), "total": earned(datetime(2000, 1, 1, tzinfo=timezone.utc)),
        "trips_today": db.scalar(completed.where(Ride.completed_at >= today)) or 0,
        "trips_total": db.scalar(completed) or 0,
        "distance_km": round(dist / 1000, 1),
        "rating": user.rating_avg, "rating_count": user.rating_count,
        "wallet_balance": user.wallet_balance,
        "daily": daily,
    }
