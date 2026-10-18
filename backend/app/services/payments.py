"""Stripe integration (stripe-python). Falls back to a 'demo' mode when no keys are set,
so the full flow can be tested without a Stripe account."""
import logging

import stripe
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..models import Payment, Ride, User, WalletTransaction
from . import rides as ride_svc

log = logging.getLogger(__name__)

if settings.STRIPE_SECRET_KEY:
    stripe.api_key = settings.STRIPE_SECRET_KEY


def create_intent(db: Session, user: User, amount: float, purpose: str, ride: Ride | None = None) -> Payment:
    payment = Payment(user_id=user.id, ride_id=ride.id if ride else None, purpose=purpose,
                      amount=round(amount, 2), currency=settings.CURRENCY, method="card")
    db.add(payment)
    db.flush()
    if settings.stripe_enabled:
        intent = stripe.PaymentIntent.create(
            amount=int(round(amount * 100)),  # smallest currency unit (paise)
            currency=settings.CURRENCY,
            automatic_payment_methods={"enabled": True},
            metadata={"payment_id": payment.id, "purpose": purpose, "user_id": user.id,
                      "ride_id": ride.id if ride else ""},
            description=f"GoCab {purpose}" + (f" – ride #{ride.id}" if ride else ""),
        )
        payment.stripe_payment_intent_id = intent.id
        payment.client_secret = intent.client_secret  # transient attribute
    db.commit()
    return payment


def fulfil(db: Session, payment: Payment) -> None:
    """Mark a payment succeeded and apply its effect (idempotent)."""
    if payment.status == "succeeded":
        return
    payment.status = "succeeded"
    if payment.purpose == "topup":
        user = db.get(User, payment.user_id)
        user.wallet_balance = round(user.wallet_balance + payment.amount, 2)
        db.add(WalletTransaction(user_id=user.id, amount=payment.amount, kind="topup",
                                 description="Wallet top-up" + (" (Stripe)" if payment.stripe_payment_intent_id else " (demo)")))
        # cashback promo for top-ups >= 500
        if payment.amount >= 500:
            bonus = round(payment.amount * 0.05, 2)
            user.wallet_balance = round(user.wallet_balance + bonus, 2)
            db.add(WalletTransaction(user_id=user.id, amount=bonus, kind="bonus", description="5% top-up cashback"))
        db.commit()
    elif payment.purpose == "ride" and payment.ride_id:
        ride = db.get(Ride, payment.ride_id)
        ride.payment_method = "card"
        ride_svc.mark_paid(db, ride)
        ride_svc.push_update(db, ride)
    db.commit()


def sync_with_stripe(db: Session, payment: Payment) -> Payment:
    """Check PaymentIntent status directly (useful locally when webhooks aren't forwarded)."""
    if settings.stripe_enabled and payment.stripe_payment_intent_id and payment.status != "succeeded":
        intent = stripe.PaymentIntent.retrieve(payment.stripe_payment_intent_id)
        if intent.status == "succeeded":
            fulfil(db, payment)
        elif intent.status in ("canceled", "requires_payment_method") and payment.status == "pending":
            pass
    return payment


def handle_webhook(db: Session, payload: bytes, sig_header: str | None) -> str:
    if settings.STRIPE_WEBHOOK_SECRET:
        event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
    else:
        if settings.ENV == "production":
            raise ValueError("Webhook secret not configured")
        import json
        event = json.loads(payload)
    etype = event["type"]
    obj = event["data"]["object"]
    payment = db.scalar(select(Payment).where(Payment.stripe_payment_intent_id == obj.get("id")))
    if payment is None:
        return f"ignored {etype}"
    if etype == "payment_intent.succeeded":
        fulfil(db, payment)
    elif etype == "payment_intent.payment_failed":
        payment.status = "failed"
        db.commit()
    return f"handled {etype}"
