"""SQLAlchemy models — users, drivers, rides, payments, reviews, promos, wallet."""
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Role:
    RIDER = "rider"
    DRIVER = "driver"
    ADMIN = "admin"


class RideStatus:
    REQUESTED = "requested"      # waiting for a driver
    ACCEPTED = "accepted"        # driver on the way to pickup
    ARRIVED = "arrived"          # driver at pickup, waiting for OTP
    STARTED = "started"          # trip in progress
    COMPLETED = "completed"
    CANCELLED = "cancelled"

    ACTIVE = (REQUESTED, ACCEPTED, ARRIVED, STARTED)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(20), default=Role.RIDER, index=True)
    profile_pic: Mapped[str | None] = mapped_column(String(500), nullable=True)
    rating_avg: Mapped[float] = mapped_column(Float, default=5.0)
    rating_count: Mapped[int] = mapped_column(Integer, default=0)
    wallet_balance: Mapped[float] = mapped_column(Float, default=0.0)
    auth_provider: Mapped[str] = mapped_column(String(20), default="local")
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    driver: Mapped["Driver | None"] = relationship(back_populates="user", uselist=False)


class Driver(Base):
    __tablename__ = "drivers"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    vehicle_type: Mapped[str] = mapped_column(String(20), default="mini")
    vehicle_model: Mapped[str] = mapped_column(String(80), default="")
    vehicle_number: Mapped[str] = mapped_column(String(30), default="")
    vehicle_color: Mapped[str] = mapped_column(String(30), default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="offline", index=True)  # offline|online|on_trip
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False)
    location_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="driver")

    __table_args__ = (Index("ix_drivers_lat_lng", "lat", "lng"),)


class Ride(Base):
    __tablename__ = "rides"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rider_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    driver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    vehicle_type: Mapped[str] = mapped_column(String(20), default="mini")

    pickup_lat: Mapped[float] = mapped_column(Float)
    pickup_lng: Mapped[float] = mapped_column(Float)
    pickup_address: Mapped[str] = mapped_column(String(500), default="")
    drop_lat: Mapped[float] = mapped_column(Float)
    drop_lng: Mapped[float] = mapped_column(Float)
    drop_address: Mapped[str] = mapped_column(String(500), default="")

    status: Mapped[str] = mapped_column(String(20), default=RideStatus.REQUESTED, index=True)
    fare_estimate: Mapped[float] = mapped_column(Float, default=0)
    discount: Mapped[float] = mapped_column(Float, default=0)
    fare_actual: Mapped[float | None] = mapped_column(Float, nullable=True)
    surge: Mapped[float] = mapped_column(Float, default=1.0)
    distance_meters: Mapped[int] = mapped_column(Integer, default=0)
    duration_secs: Mapped[int] = mapped_column(Integer, default=0)
    route_geometry: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON [[lat,lng],...]

    promo_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    payment_method: Mapped[str] = mapped_column(String(20), default="cash")  # cash|wallet|card
    payment_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|paid|failed|refunded
    otp: Mapped[str] = mapped_column(String(6), default="0000")
    cancel_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cancelled_by: Mapped[str | None] = mapped_column(String(20), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rider: Mapped[User] = relationship(foreign_keys=[rider_id])
    driver: Mapped[User | None] = relationship(foreign_keys=[driver_id])


class RideDecline(Base):
    __tablename__ = "ride_declines"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="CASCADE"), index=True)
    driver_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    __table_args__ = (UniqueConstraint("ride_id", "driver_id"),)


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    ride_id: Mapped[int | None] = mapped_column(ForeignKey("rides.id"), nullable=True, index=True)
    purpose: Mapped[str] = mapped_column(String(20), default="ride")  # ride|topup
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    amount: Mapped[float] = mapped_column(Float)
    currency: Mapped[str] = mapped_column(String(10), default="inr")
    method: Mapped[str] = mapped_column(String(20), default="card")
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|succeeded|failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Review(Base):
    __tablename__ = "reviews"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id"), index=True)
    rater_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    rated_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    rating: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    rater: Mapped[User] = relationship(foreign_keys=[rater_id])
    __table_args__ = (UniqueConstraint("ride_id", "rater_id", name="uq_review_once_per_ride"),)


class Promo(Base):
    __tablename__ = "promos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    discount_type: Mapped[str] = mapped_column(String(10), default="percent")  # percent|flat
    value: Mapped[float] = mapped_column(Float)
    max_discount: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_fare: Mapped[float] = mapped_column(Float, default=0)
    usage_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class WalletTransaction(Base):
    __tablename__ = "wallet_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    amount: Mapped[float] = mapped_column(Float)  # +credit / -debit
    kind: Mapped[str] = mapped_column(String(20))  # topup|ride|refund|bonus|earning
    description: Mapped[str] = mapped_column(String(255), default="")
    ride_id: Mapped[int | None] = mapped_column(ForeignKey("rides.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
