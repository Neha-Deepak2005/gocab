"""Background jobs.

With USE_CELERY=true and REDIS_URL set, jobs go to a Celery worker:
    celery -A app.tasks.celery_app worker --loglevel=info
    celery -A app.tasks.celery_app beat   --loglevel=info   (periodic cleanup)
Otherwise they run in a background thread inside the API process, so nothing breaks
on a single free-tier instance.
"""
import logging
import threading
from datetime import datetime, timedelta, timezone

from celery import Celery
from sqlalchemy import select

from .config import settings
from .database import SessionLocal

log = logging.getLogger(__name__)

celery_app = Celery("gocab", broker=settings.REDIS_URL or "memory://", backend=None)
celery_app.conf.update(
    task_ignore_result=True,
    timezone="UTC",
    beat_schedule={
        "expire-stale-requests": {"task": "gocab.expire_stale_requests", "schedule": 300.0},
    },
)


def _send_receipt(ride_id: int) -> bool:
    from .models import Driver, Ride
    from .services.receipts import build_receipt_pdf, send_email

    with SessionLocal() as db:
        ride = db.get(Ride, ride_id)
        if not ride:
            return False
        pdf = build_receipt_pdf(ride, db.get(Driver, ride.driver_id) if ride.driver_id else None)
        total = ride.fare_actual or ride.fare_estimate
        html = f"""
        <div style="font-family:Arial,sans-serif;max-width:520px;margin:auto">
          <div style="background:linear-gradient(90deg,#7c3aed,#ec4899);color:#fff;padding:24px;border-radius:16px">
            <h1 style="margin:0">GoCab</h1><p style="margin:4px 0 0">Thanks for riding, {ride.rider.name}!</p>
          </div>
          <h2 style="color:#1e1b4b">₹{total:,.2f}</h2>
          <p><b>From:</b> {ride.pickup_address}<br><b>To:</b> {ride.drop_address}</p>
          <p>{ride.distance_meters/1000:.1f} km · {round(ride.duration_secs/60)} min · paid by {ride.payment_method}</p>
          <p style="color:#6b7280">Your PDF receipt is attached.</p>
        </div>"""
        return send_email(ride.rider.email, f"Your GoCab receipt – ride #{ride.id}", html, pdf, f"gocab-ride-{ride.id}.pdf")


def _expire_stale() -> int:
    from .models import Ride, RideStatus

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    with SessionLocal() as db:
        stale = list(db.scalars(select(Ride).where(Ride.status == RideStatus.REQUESTED, Ride.created_at < cutoff)))
        for r in stale:
            r.status = RideStatus.CANCELLED
            r.cancel_reason = "No driver found"
            r.cancelled_by = "system"
        db.commit()
        return len(stale)


@celery_app.task(name="gocab.send_receipt_email", autoretry_for=(Exception,), retry_backoff=True, max_retries=3)
def send_receipt_email_task(ride_id: int):
    return _send_receipt(ride_id)


@celery_app.task(name="gocab.expire_stale_requests")
def expire_stale_requests_task():
    return _expire_stale()


def _in_thread(fn, *args):
    def run():
        try:
            fn(*args)
        except Exception:
            log.exception("background job %s failed", fn.__name__)

    threading.Thread(target=run, daemon=True).start()


def enqueue_receipt_email(ride_id: int) -> None:
    if settings.USE_CELERY and settings.REDIS_URL:
        try:
            send_receipt_email_task.delay(ride_id)
            return
        except Exception as exc:
            log.warning("Celery unavailable (%s); running inline", exc)
    _in_thread(_send_receipt, ride_id)
