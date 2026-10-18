"""Ride lifecycle logic shared by the REST routers, websocket handlers and demo bots."""
import json
import random
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Driver, Promo, Review, Ride, RideDecline, RideStatus, User, WalletTransaction
from ..schemas import DriverOut, LatLng, PersonBrief, RideOut
from .matching import nearby_drivers
from .realtime import hub

DRIVER_COMMISSION = 0.80  # driver keeps 80% of fare
MATCH_RADIUS_M = 6000


def now() -> datetime:
    return datetime.now(timezone.utc)


def serialize(ride: Ride, viewer: User | None, db: Session, with_geometry: bool = True) -> dict:
    out = RideOut.model_validate(ride)
    if viewer is None or viewer.id != ride.rider_id:
        out.otp = None  # only the rider sees the OTP
    if with_geometry and ride.route_geometry:
        out.geometry = json.loads(ride.route_geometry)
    out.rider = PersonBrief.model_validate(ride.rider) if ride.rider else None
    if ride.driver:
        out.driver = PersonBrief.model_validate(ride.driver)
        d = db.get(Driver, ride.driver_id)
        if d:
            out.vehicle = DriverOut.model_validate(d)
            if d.lat is not None and ride.status in RideStatus.ACTIVE:
                out.driver_location = LatLng(lat=d.lat, lng=d.lng)
    if viewer is not None:
        out.my_review = db.scalar(
            select(Review.rating).where(Review.ride_id == ride.id, Review.rater_id == viewer.id)
        )
    return out.model_dump(mode="json")


def push_update(db: Session, ride: Ride, event: str = "ride_update") -> None:
    db.refresh(ride)
    hub.notify(ride.rider_id, {"type": event, "ride": serialize(ride, ride.rider, db)})
    if ride.driver_id:
        hub.notify(ride.driver_id, {"type": event, "ride": serialize(ride, ride.driver, db)})


def broadcast_request(db: Session, ride: Ride) -> list[int]:
    """Push a new ride request to nearby online human drivers of the right vehicle type."""
    declined = set(db.scalars(select(RideDecline.driver_id).where(RideDecline.ride_id == ride.id)))
    targets = []
    for d, dist in nearby_drivers(db, ride.pickup_lat, ride.pickup_lng, MATCH_RADIUS_M, ride.vehicle_type):
        if d.is_bot or d.user_id in declined:
            continue
        payload = serialize(ride, None, db)
        payload["pickup_distance_m"] = int(dist)
        hub.notify(d.user_id, {"type": "ride_request", "ride": payload})
        targets.append(d.user_id)
    return targets


def get_ride_for(db: Session, ride_id: int, user: User) -> Ride:
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(404, "Ride not found")
    if user.role != "admin" and user.id not in (ride.rider_id, ride.driver_id):
        # drivers may view open requests
        if not (user.role == "driver" and ride.status == RideStatus.REQUESTED):
            raise HTTPException(403, "Not your ride")
    return ride


def new_otp() -> str:
    return f"{random.randint(0, 9999):04d}"


def accept(db: Session, ride: Ride, driver_user: User) -> Ride:
    drv = db.get(Driver, driver_user.id)
    if drv is None:
        raise HTTPException(400, "Driver profile missing")
    # row-level lock on Postgres to avoid two drivers grabbing the same ride
    locked = db.scalar(select(Ride).where(Ride.id == ride.id).with_for_update()) or ride
    if locked.status != RideStatus.REQUESTED:
        raise HTTPException(409, "Ride is no longer available")
    if drv.status == "on_trip":
        raise HTTPException(409, "Finish your current trip first")
    locked.driver_id = driver_user.id
    locked.status = RideStatus.ACCEPTED
    locked.accepted_at = now()
    drv.status = "on_trip"
    db.commit()
    push_update(db, locked)
    # let other drivers know it's gone
    for d, _ in nearby_drivers(db, locked.pickup_lat, locked.pickup_lng, MATCH_RADIUS_M, locked.vehicle_type):
        if d.user_id != driver_user.id:
            hub.notify(d.user_id, {"type": "ride_taken", "ride_id": locked.id})
    return locked


def decline(db: Session, ride: Ride, driver_user: User) -> None:
    if not db.scalar(select(RideDecline).where(RideDecline.ride_id == ride.id, RideDecline.driver_id == driver_user.id)):
        db.add(RideDecline(ride_id=ride.id, driver_id=driver_user.id))
        db.commit()


def _require_driver(ride: Ride, user: User):
    if ride.driver_id != user.id:
        raise HTTPException(403, "Not your ride")


def arrived(db: Session, ride: Ride, driver_user: User) -> Ride:
    _require_driver(ride, driver_user)
    if ride.status != RideStatus.ACCEPTED:
        raise HTTPException(409, f"Cannot mark arrived from '{ride.status}'")
    ride.status = RideStatus.ARRIVED
    db.commit()
    push_update(db, ride)
    return ride


def start(db: Session, ride: Ride, driver_user: User, otp: str | None, skip_otp: bool = False) -> Ride:
    _require_driver(ride, driver_user)
    if ride.status not in (RideStatus.ACCEPTED, RideStatus.ARRIVED):
        raise HTTPException(409, f"Cannot start from '{ride.status}'")
    if not skip_otp and otp != ride.otp:
        raise HTTPException(400, "Incorrect OTP – ask the rider for the 4-digit code")
    ride.status = RideStatus.STARTED
    ride.started_at = now()
    db.commit()
    push_update(db, ride)
    return ride


def credit_driver(db: Session, ride: Ride) -> None:
    if not ride.driver_id or ride.fare_actual is None:
        return
    exists = db.scalar(
        select(WalletTransaction).where(WalletTransaction.ride_id == ride.id, WalletTransaction.kind == "earning")
    )
    if exists:
        return
    amount = round(ride.fare_actual * DRIVER_COMMISSION, 2)
    drv_user = db.get(User, ride.driver_id)
    if ride.payment_method != "cash":  # cash is already in the driver's pocket
        drv_user.wallet_balance = round(drv_user.wallet_balance + amount, 2)
    db.add(WalletTransaction(user_id=drv_user.id, amount=amount, kind="earning", ride_id=ride.id,
                             description=f"Earnings for ride #{ride.id} ({ride.payment_method})"))


def mark_paid(db: Session, ride: Ride) -> None:
    ride.payment_status = "paid"
    credit_driver(db, ride)
    db.commit()


def complete(db: Session, ride: Ride, driver_user: User) -> Ride:
    _require_driver(ride, driver_user)
    if ride.status != RideStatus.STARTED:
        raise HTTPException(409, f"Cannot complete from '{ride.status}'")
    ride.status = RideStatus.COMPLETED
    ride.completed_at = now()
    ride.fare_actual = round(max(ride.fare_estimate - ride.discount, 0), 2)
    drv = db.get(Driver, driver_user.id)
    if drv:
        drv.status = "online"
        drv.lat, drv.lng = ride.drop_lat, ride.drop_lng

    # settle payment
    if ride.payment_method == "cash":
        mark_paid(db, ride)
    elif ride.payment_method == "wallet":
        rider = db.get(User, ride.rider_id)
        if rider.wallet_balance >= ride.fare_actual:
            rider.wallet_balance = round(rider.wallet_balance - ride.fare_actual, 2)
            db.add(WalletTransaction(user_id=rider.id, amount=-ride.fare_actual, kind="ride", ride_id=ride.id,
                                     description=f"Ride #{ride.id}"))
            mark_paid(db, ride)
        else:
            ride.payment_method = "card"  # insufficient balance -> pay by card
    db.commit()
    push_update(db, ride)

    from ..tasks import enqueue_receipt_email
    enqueue_receipt_email(ride.id)
    return ride


def cancel(db: Session, ride: Ride, user: User, reason: str | None) -> Ride:
    if ride.status not in RideStatus.ACTIVE:
        raise HTTPException(409, "Ride can no longer be cancelled")
    if ride.status == RideStatus.STARTED:
        raise HTTPException(409, "Trip already started")

    if user.id == ride.driver_id:
        # driver backs out -> free the driver and send the ride back to the pool
        drv = db.get(Driver, user.id)
        if drv:
            drv.status = "online"
        db.add(RideDecline(ride_id=ride.id, driver_id=user.id))
        ride.driver_id = None
        ride.status = RideStatus.REQUESTED
        ride.accepted_at = None
        db.commit()
        hub.notify(user.id, {"type": "ride_update", "ride": serialize(ride, user, db)})
        push_update(db, ride)
        notified = broadcast_request(db, ride)
        from .simulator import schedule_bot
        schedule_bot(ride.id, len(notified))
        return ride

    ride.status = RideStatus.CANCELLED
    ride.cancel_reason = reason or "Cancelled by rider"
    ride.cancelled_by = "rider"
    if ride.driver_id:
        drv = db.get(Driver, ride.driver_id)
        if drv:
            drv.status = "online"
    if ride.promo_code:
        promo = db.scalar(select(Promo).where(Promo.code == ride.promo_code))
        if promo and promo.used_count > 0:
            promo.used_count -= 1
    db.commit()
    push_update(db, ride)
    for d, _ in nearby_drivers(db, ride.pickup_lat, ride.pickup_lng, MATCH_RADIUS_M, ride.vehicle_type):
        hub.notify(d.user_id, {"type": "ride_taken", "ride_id": ride.id})
    return ride
