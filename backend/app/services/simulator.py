"""Demo bot drivers.

When DEMO_BOTS=true, a ride that no human driver accepts within BOT_ACCEPT_DELAY seconds
is picked up by a simulated driver, which drives to the pickup, waits, and drives to the
drop-off, streaming live location updates over the same websocket channel real drivers use.
This lets a single person demo the full flow. Set DEMO_BOTS=false in production.
"""
import asyncio
import logging
import math
import random

from sqlalchemy import select

from ..config import settings
from ..database import SessionLocal
from ..models import Driver, Ride, RideStatus, User
from . import rides as ride_svc
from .maps import get_route, haversine
from .matching import nearby_drivers
from .realtime import hub

log = logging.getLogger(__name__)
_running: set[int] = set()


def schedule_bot(ride_id: int, humans_notified: int = 0) -> None:
    if not settings.DEMO_BOTS or hub.loop is None or ride_id in _running:
        return
    _running.add(ride_id)
    delay = settings.BOT_HUMAN_GRACE if humans_notified else settings.BOT_ACCEPT_DELAY
    asyncio.run_coroutine_threadsafe(_run(ride_id, delay), hub.loop)


def _pick_bot(ride_id: int) -> tuple[int, list[list[float]], int] | None:
    """Accept the ride with the nearest free bot. Returns (bot_id, approach_route, duration)."""
    with SessionLocal() as db:
        ride = db.get(Ride, ride_id)
        if not ride or ride.status != RideStatus.REQUESTED:
            return None
        cands = [d for d, _ in nearby_drivers(db, ride.pickup_lat, ride.pickup_lng, 8000, ride.vehicle_type) if d.is_bot]
        if cands:
            bot = cands[0]
        else:
            bot = db.scalar(select(Driver).where(Driver.is_bot.is_(True), Driver.status == "online",
                                                 Driver.vehicle_type == ride.vehicle_type))
            if bot is None:
                return None
            r, ang = random.uniform(700, 1800), random.uniform(0, 2 * math.pi)
            bot.lat = ride.pickup_lat + r * math.cos(ang) / 111_000
            bot.lng = ride.pickup_lng + r * math.sin(ang) / (111_000 * math.cos(math.radians(ride.pickup_lat)))
            db.commit()
        start = (bot.lat, bot.lng)
        ride_svc.accept(db, ride, db.get(User, bot.user_id))
        route = get_route(start, (ride.pickup_lat, ride.pickup_lng))
        return bot.user_id, route.geometry, route.duration_secs


def _point_along(geom: list[list[float]], frac: float) -> list[float]:
    if len(geom) < 2:
        return geom[0]
    segs = [haversine(*geom[i], *geom[i + 1]) for i in range(len(geom) - 1)]
    total = sum(segs) or 1
    target = total * min(max(frac, 0), 1)
    acc = 0.0
    for i, s in enumerate(segs):
        if acc + s >= target:
            t = (target - acc) / s if s else 0
            return [geom[i][0] + (geom[i + 1][0] - geom[i][0]) * t, geom[i][1] + (geom[i + 1][1] - geom[i][1]) * t]
        acc += s
    return geom[-1]


def _move(bot_id: int, ride_id: int, lat: float, lng: float, eta: int) -> bool:
    """Update bot position; returns False if the ride is no longer active for this bot."""
    with SessionLocal() as db:
        ride = db.get(Ride, ride_id)
        if not ride or ride.driver_id != bot_id or ride.status not in RideStatus.ACTIVE:
            return False
        drv = db.get(Driver, bot_id)
        drv.lat, drv.lng = lat, lng
        db.commit()
    hub.notify(ride.rider_id, {"type": "driver_location", "ride_id": ride_id, "lat": lat, "lng": lng, "eta_secs": eta})
    return True


def _step(ride_id: int, bot_id: int, action: str) -> bool:
    with SessionLocal() as db:
        ride = db.get(Ride, ride_id)
        if not ride or ride.driver_id != bot_id or ride.status not in RideStatus.ACTIVE:
            return False
        bot = db.get(User, bot_id)
        if action == "arrived":
            ride_svc.arrived(db, ride, bot)
        elif action == "start":
            ride_svc.start(db, ride, bot, None, skip_otp=True)
        elif action == "complete":
            ride_svc.complete(db, ride, bot)
        return True


def _trip_route(ride_id: int) -> tuple[list[list[float]], int]:
    with SessionLocal() as db:
        ride = db.get(Ride, ride_id)
        import json
        geom = json.loads(ride.route_geometry) if ride.route_geometry else [[ride.pickup_lat, ride.pickup_lng], [ride.drop_lat, ride.drop_lng]]
        return geom, ride.duration_secs


def _release(bot_id: int) -> None:
    with SessionLocal() as db:
        drv = db.get(Driver, bot_id)
        if drv and drv.status == "on_trip":
            active = db.scalar(select(Ride).where(Ride.driver_id == bot_id, Ride.status.in_(RideStatus.ACTIVE)))
            if not active:
                drv.status = "online"
                db.commit()


async def _drive(bot_id: int, ride_id: int, geom: list[list[float]], real_secs: int, sim_secs: float) -> bool:
    steps = max(int(sim_secs / settings.BOT_SPEED_FACTOR), 4)
    for i in range(1, steps + 1):
        frac = i / steps
        lat, lng = _point_along(geom, frac)
        eta = int(real_secs * (1 - frac))
        if not await asyncio.to_thread(_move, bot_id, ride_id, lat, lng, eta):
            return False
        await asyncio.sleep(1.0)
    return True


async def _run(ride_id: int, delay: float) -> None:
    bot_id = None
    try:
        await asyncio.sleep(delay)
        picked = await asyncio.to_thread(_pick_bot, ride_id)
        if not picked:
            return
        bot_id, approach, approach_secs = picked
        if not await _drive(bot_id, ride_id, approach, approach_secs, sim_secs=min(max(approach_secs / 12, 10), 20)):
            return
        if not await asyncio.to_thread(_step, ride_id, bot_id, "arrived"):
            return
        await asyncio.sleep(6 / settings.BOT_SPEED_FACTOR)
        if not await asyncio.to_thread(_step, ride_id, bot_id, "start"):
            return
        geom, trip_secs = await asyncio.to_thread(_trip_route, ride_id)
        if not await _drive(bot_id, ride_id, geom, trip_secs, sim_secs=min(max(trip_secs / 15, 15), 35)):
            return
        await asyncio.to_thread(_step, ride_id, bot_id, "complete")
    except Exception:
        log.exception("bot simulation failed for ride %s", ride_id)
    finally:
        _running.discard(ride_id)
        if bot_id:
            await asyncio.to_thread(_release, bot_id)
