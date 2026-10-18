import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Driver, Promo, Ride, RideStatus, User
from ..schemas import CancelIn, EstimateOut, FareOption, RideRequestIn, StartIn
from ..security import get_current_user, get_driver, get_rider
from ..services import rides as ride_svc
from ..services.maps import VEHICLES, calc_fare, get_route
from ..services.matching import apply_promo, ensure_demo_drivers_near, nearby_drivers, surge_multiplier
from ..services.receipts import build_receipt_pdf
from ..services.simulator import schedule_bot
from ..tasks import enqueue_receipt_email

router = APIRouter(prefix="/api/rides", tags=["rides"])


def _parse_point(s: str) -> tuple[float, float]:
    try:
        lat, lng = (float(x) for x in s.split(","))
        assert -90 <= lat <= 90 and -180 <= lng <= 180
        return lat, lng
    except Exception:
        raise HTTPException(422, f"Invalid coordinate '{s}', expected 'lat,lng'")


def build_estimate(db: Session, origin, dest, promo: str | None) -> EstimateOut:
    route = get_route(origin, dest)
    if route.distance_meters > 300_000:
        raise HTTPException(422, "Trips are limited to 300 km")
    ensure_demo_drivers_near(db, *origin)
    surge = surge_multiplier(db, *origin)
    options, promo_msg, applied = [], None, None
    for vt, (label, seats, *_rest) in VEHICLES.items():
        fare = calc_fare(vt, route.distance_meters, route.duration_secs, surge)
        disc, msg = apply_promo(db, promo, fare)
        if promo:
            promo_msg = msg if (disc or promo_msg is None) else promo_msg
            applied = promo.upper() if disc else applied
        near = nearby_drivers(db, origin[0], origin[1], 6000, vt)
        eta = max(2, round(near[0][1] / 1000 / 25 * 60) + 1) if near else None  # ~25 km/h
        options.append(FareOption(vehicle_type=vt, label=label, seats=seats, fare=fare - disc,
                                  fare_before_discount=fare, discount=disc, surge=surge,
                                  eta_minutes=eta, drivers_nearby=len(near)))
    return EstimateOut(distance_meters=route.distance_meters, duration_secs=route.duration_secs,
                       geometry=route.geometry, provider=route.provider, options=options,
                       promo_applied=applied, promo_message=promo_msg)


@router.get("/estimate", response_model=EstimateOut)
def estimate(origin: str = Query(..., examples=["12.9716,77.5946"]),
             dest: str = Query(..., examples=["12.9352,77.6245"]),
             promo: str | None = None,
             db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Fare estimate for every vehicle class (distance/time from Google Directions or OSRM)."""
    return build_estimate(db, _parse_point(origin), _parse_point(dest), promo)


@router.post("/request", status_code=201)
def request_ride(data: RideRequestIn, user: User = Depends(get_rider), db: Session = Depends(get_db)):
    active = db.scalar(select(Ride).where(Ride.rider_id == user.id, Ride.status.in_(RideStatus.ACTIVE)))
    if active:
        raise HTTPException(409, f"You already have an active ride (#{active.id})")
    origin, dest = (data.pickup.lat, data.pickup.lng), (data.drop.lat, data.drop.lng)
    route = get_route(origin, dest)
    if route.distance_meters < 100:
        raise HTTPException(422, "Pickup and drop are too close")
    surge = surge_multiplier(db, *origin)
    fare = calc_fare(data.vehicle_type, route.distance_meters, route.duration_secs, surge)
    disc, msg = apply_promo(db, data.promo_code, fare)
    if data.promo_code and not disc:
        raise HTTPException(422, msg or "Invalid promo code")
    if data.payment_method == "wallet" and user.wallet_balance < fare - disc:
        raise HTTPException(422, f"Wallet balance ₹{user.wallet_balance:.0f} is too low for this ride – top up or pick another method")

    ride = Ride(rider_id=user.id, vehicle_type=data.vehicle_type,
                pickup_lat=data.pickup.lat, pickup_lng=data.pickup.lng, pickup_address=data.pickup_address,
                drop_lat=data.drop.lat, drop_lng=data.drop.lng, drop_address=data.drop_address,
                fare_estimate=fare, discount=disc, surge=surge,
                distance_meters=route.distance_meters, duration_secs=route.duration_secs,
                route_geometry=json.dumps(route.geometry),
                promo_code=data.promo_code if disc else None, payment_method=data.payment_method,
                otp=ride_svc.new_otp())
    db.add(ride)
    if disc:
        promo = db.scalar(select(Promo).where(Promo.code == data.promo_code))
        promo.used_count += 1
    db.commit()
    db.refresh(ride)
    notified = ride_svc.broadcast_request(db, ride)
    schedule_bot(ride.id, len(notified))
    out = ride_svc.serialize(ride, user, db)
    out["drivers_notified"] = len(notified)
    return out


@router.get("")
def history(status: str | None = None, limit: int = Query(50, le=200), offset: int = 0,
            user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Ride history for the current rider or driver (newest first)."""
    q = select(Ride).where(or_(Ride.rider_id == user.id, Ride.driver_id == user.id))
    if status:
        q = q.where(Ride.status == status)
    rides = db.scalars(q.order_by(Ride.created_at.desc()).limit(limit).offset(offset))
    return [ride_svc.serialize(r, user, db, with_geometry=False) for r in rides]


@router.get("/active")
def active_ride(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ride = db.scalar(select(Ride).where(or_(Ride.rider_id == user.id, Ride.driver_id == user.id),
                                        Ride.status.in_(RideStatus.ACTIVE)).order_by(Ride.created_at.desc()))
    return ride_svc.serialize(ride, user, db) if ride else None


@router.get("/{ride_id}")
def get_ride(ride_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return ride_svc.serialize(ride_svc.get_ride_for(db, ride_id, user), user, db)


@router.get("/{ride_id}/status")
def ride_status(ride_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Lightweight polling endpoint (the websocket pushes the same info in realtime)."""
    ride = ride_svc.get_ride_for(db, ride_id, user)
    drv = db.get(Driver, ride.driver_id) if ride.driver_id else None
    return {"id": ride.id, "status": ride.status, "payment_status": ride.payment_status,
            "driver_location": {"lat": drv.lat, "lng": drv.lng} if drv and drv.lat is not None else None}


@router.post("/{ride_id}/cancel")
def cancel_ride(ride_id: int, data: CancelIn | None = None, user: User = Depends(get_current_user),
                db: Session = Depends(get_db)):
    ride = ride_svc.get_ride_for(db, ride_id, user)
    if user.id not in (ride.rider_id, ride.driver_id):
        raise HTTPException(403, "Not your ride")
    return ride_svc.serialize(ride_svc.cancel(db, ride, user, data.reason if data else None), user, db)


# ---- driver actions ----
@router.post("/{ride_id}/accept")
def accept_ride(ride_id: int, user: User = Depends(get_driver), db: Session = Depends(get_db)):
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(404, "Ride not found")
    return ride_svc.serialize(ride_svc.accept(db, ride, user), user, db)


@router.post("/{ride_id}/decline")
def decline_ride(ride_id: int, user: User = Depends(get_driver), db: Session = Depends(get_db)):
    ride = db.get(Ride, ride_id)
    if not ride:
        raise HTTPException(404, "Ride not found")
    ride_svc.decline(db, ride, user)
    return {"ok": True}


@router.post("/{ride_id}/arrived")
def mark_arrived(ride_id: int, user: User = Depends(get_driver), db: Session = Depends(get_db)):
    ride = ride_svc.get_ride_for(db, ride_id, user)
    return ride_svc.serialize(ride_svc.arrived(db, ride, user), user, db)


@router.post("/{ride_id}/start")
def start_ride(ride_id: int, data: StartIn, user: User = Depends(get_driver), db: Session = Depends(get_db)):
    ride = ride_svc.get_ride_for(db, ride_id, user)
    return ride_svc.serialize(ride_svc.start(db, ride, user, data.otp), user, db)


@router.post("/{ride_id}/complete")
def complete_ride(ride_id: int, user: User = Depends(get_driver), db: Session = Depends(get_db)):
    ride = ride_svc.get_ride_for(db, ride_id, user)
    return ride_svc.serialize(ride_svc.complete(db, ride, user), user, db)


# ---- receipts ----
@router.get("/{ride_id}/receipt")
def receipt_pdf(ride_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ride = ride_svc.get_ride_for(db, ride_id, user)
    if ride.status != RideStatus.COMPLETED:
        raise HTTPException(409, "Receipt is available once the ride is completed")
    pdf = build_receipt_pdf(ride, db.get(Driver, ride.driver_id) if ride.driver_id else None)
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="gocab-ride-{ride.id}.pdf"'})


@router.post("/{ride_id}/email-receipt")
def email_receipt(ride_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ride = ride_svc.get_ride_for(db, ride_id, user)
    if ride.status != RideStatus.COMPLETED:
        raise HTTPException(409, "Ride not completed yet")
    enqueue_receipt_email(ride.id)
    return {"queued": True, "to": ride.rider.email}
