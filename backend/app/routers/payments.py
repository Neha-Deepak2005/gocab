from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..models import Payment, Promo, Ride, RideStatus, User, WalletTransaction
from ..schemas import (PaymentConfigOut, PaymentIntentOut, PromoOut, PromoValidateIn, PromoValidateOut,
                       TopupIn, WalletOut, WalletTxOut)
from ..security import get_current_user
from ..services import payments as pay_svc
from ..services.matching import apply_promo

router = APIRouter(prefix="/api", tags=["payments, wallet & promos"])


def _intent_out(p: Payment) -> PaymentIntentOut:
    return PaymentIntentOut(payment_id=p.id, mode="stripe" if settings.stripe_enabled else "demo",
                            client_secret=getattr(p, "client_secret", None), amount=p.amount, status=p.status)


@router.get("/payments/config", response_model=PaymentConfigOut)
def payment_config():
    return PaymentConfigOut(mode="stripe" if settings.stripe_enabled else "demo",
                            publishable_key=settings.STRIPE_PUBLISHABLE_KEY, currency=settings.CURRENCY)


@router.post("/payments/ride/{ride_id}/intent", response_model=PaymentIntentOut)
def ride_payment_intent(ride_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Create a Stripe PaymentIntent for a completed card ride."""
    ride = db.get(Ride, ride_id)
    if not ride or ride.rider_id != user.id:
        raise HTTPException(404, "Ride not found")
    if ride.status != RideStatus.COMPLETED:
        raise HTTPException(409, "You can pay once the ride is completed")
    if ride.payment_status == "paid":
        raise HTTPException(409, "Ride already paid")
    p = pay_svc.create_intent(db, user, ride.fare_actual, "ride", ride)
    if not settings.stripe_enabled:
        pay_svc.fulfil(db, p)  # demo mode: succeed instantly
    return _intent_out(p)


@router.post("/payments/{payment_id}/confirm", response_model=PaymentIntentOut)
def confirm_payment(payment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Called by the frontend after Stripe.js confirms; double-checks status with Stripe."""
    p = db.get(Payment, payment_id)
    if not p or p.user_id != user.id:
        raise HTTPException(404, "Payment not found")
    pay_svc.sync_with_stripe(db, p)
    return _intent_out(p)


@router.post("/webhooks/stripe", include_in_schema=True)
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Stripe webhook – verifies the Stripe-Signature header and fulfils payments."""
    payload = await request.body()
    try:
        result = pay_svc.handle_webhook(db, payload, request.headers.get("stripe-signature"))
    except Exception as exc:
        raise HTTPException(400, f"Webhook error: {exc}")
    return {"received": True, "result": result}


# ---------- wallet ----------
@router.get("/wallet", response_model=WalletOut)
def wallet(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    txs = db.scalars(select(WalletTransaction).where(WalletTransaction.user_id == user.id)
                     .order_by(WalletTransaction.created_at.desc()).limit(100))
    return WalletOut(balance=user.wallet_balance, transactions=[WalletTxOut.model_validate(t) for t in txs])


@router.post("/wallet/topup", response_model=PaymentIntentOut)
def topup(data: TopupIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Top up the wallet via Stripe (or instantly in demo mode). 5% cashback on ₹500+."""
    p = pay_svc.create_intent(db, user, data.amount, "topup")
    if not settings.stripe_enabled:
        pay_svc.fulfil(db, p)
    return _intent_out(p)


# ---------- promos ----------
@router.get("/promos", response_model=list[PromoOut])
def promos(db: Session = Depends(get_db)):
    return list(db.scalars(select(Promo).where(Promo.active.is_(True)).order_by(Promo.id)))


@router.post("/promos/validate", response_model=PromoValidateOut)
def validate_promo(data: PromoValidateIn, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    disc, msg = apply_promo(db, data.code, data.fare)
    return PromoValidateOut(valid=disc > 0, discount=disc, message=msg)
