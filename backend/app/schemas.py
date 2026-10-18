"""Pydantic request/response schemas (input validation + serialization)."""
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

VehicleType = Literal["bike", "auto", "mini", "sedan", "suv"]
PaymentMethod = Literal["cash", "wallet", "card"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Auth / users ----------
class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    phone: str | None = Field(default=None, max_length=30)
    role: Literal["rider", "driver"] = "rider"
    vehicle_type: VehicleType | None = None
    vehicle_model: str | None = Field(default=None, max_length=80)
    vehicle_number: str | None = Field(default=None, max_length=30)
    vehicle_color: str | None = Field(default=None, max_length=30)


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class SessionIn(BaseModel):
    token: str


class DriverOut(ORM):
    vehicle_type: str
    vehicle_model: str
    vehicle_number: str
    vehicle_color: str
    verified: bool
    status: str
    lat: float | None
    lng: float | None


class UserOut(ORM):
    id: int
    name: str
    email: str
    phone: str | None
    role: str
    profile_pic: str | None
    rating_avg: float
    rating_count: int
    wallet_balance: float
    created_at: datetime
    driver: DriverOut | None = None


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    profile_pic: str | None = Field(default=None, max_length=500)


class DriverUpdate(BaseModel):
    vehicle_type: VehicleType | None = None
    vehicle_model: str | None = Field(default=None, max_length=80)
    vehicle_number: str | None = Field(default=None, max_length=30)
    vehicle_color: str | None = Field(default=None, max_length=30)


# ---------- Geo ----------
class LatLng(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)


class DriverStatusIn(BaseModel):
    status: Literal["online", "offline"]
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)


# ---------- Rides ----------
class FareOption(BaseModel):
    vehicle_type: str
    label: str
    seats: int
    fare: float
    fare_before_discount: float
    discount: float
    surge: float
    eta_minutes: int | None
    drivers_nearby: int


class EstimateOut(BaseModel):
    distance_meters: int
    duration_secs: int
    geometry: list[list[float]]
    provider: str
    options: list[FareOption]
    promo_applied: str | None = None
    promo_message: str | None = None


class RideRequestIn(BaseModel):
    pickup: LatLng
    drop: LatLng
    pickup_address: str = Field(default="", max_length=500)
    drop_address: str = Field(default="", max_length=500)
    vehicle_type: VehicleType = "mini"
    payment_method: PaymentMethod = "cash"
    promo_code: str | None = Field(default=None, max_length=40)

    @field_validator("promo_code")
    @classmethod
    def upper(cls, v):
        return v.strip().upper() if v else None


class PersonBrief(ORM):
    id: int
    name: str
    phone: str | None
    rating_avg: float
    rating_count: int
    profile_pic: str | None


class RideOut(ORM):
    id: int
    rider_id: int
    driver_id: int | None
    vehicle_type: str
    pickup_lat: float
    pickup_lng: float
    pickup_address: str
    drop_lat: float
    drop_lng: float
    drop_address: str
    status: str
    fare_estimate: float
    discount: float
    fare_actual: float | None
    surge: float
    distance_meters: int
    duration_secs: int
    promo_code: str | None
    payment_method: str
    payment_status: str
    cancel_reason: str | None
    cancelled_by: str | None
    created_at: datetime
    accepted_at: datetime | None
    started_at: datetime | None
    completed_at: datetime | None
    otp: str | None = None
    geometry: list[list[float]] | None = None
    rider: PersonBrief | None = None
    driver: PersonBrief | None = None
    vehicle: DriverOut | None = None
    driver_location: LatLng | None = None
    my_review: int | None = None


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=255)


class StartIn(BaseModel):
    otp: str = Field(min_length=4, max_length=6)


# ---------- Reviews ----------
class ReviewIn(BaseModel):
    ride_id: int
    rating: int = Field(ge=1, le=5)
    comment: str | None = Field(default=None, max_length=1000)


class ReviewOut(ORM):
    id: int
    ride_id: int
    rater_id: int
    rated_id: int
    rating: int
    comment: str | None
    created_at: datetime
    rater_name: str | None = None


class ReviewSummary(BaseModel):
    user_id: int
    average: float
    count: int
    distribution: dict[int, int]
    reviews: list[ReviewOut]


# ---------- Promos / wallet / payments ----------
class PromoOut(ORM):
    code: str
    description: str
    discount_type: str
    value: float
    max_discount: float | None
    min_fare: float
    expires_at: datetime | None


class PromoValidateIn(BaseModel):
    code: str
    fare: float = Field(gt=0)


class PromoValidateOut(BaseModel):
    valid: bool
    discount: float
    message: str


class WalletTxOut(ORM):
    id: int
    amount: float
    kind: str
    description: str
    ride_id: int | None
    created_at: datetime


class WalletOut(BaseModel):
    balance: float
    transactions: list[WalletTxOut]


class TopupIn(BaseModel):
    amount: float = Field(gt=0, le=50000)


class PaymentIntentOut(BaseModel):
    payment_id: int
    mode: Literal["stripe", "demo"]
    client_secret: str | None = None
    amount: float
    status: str


class PaymentConfigOut(BaseModel):
    mode: Literal["stripe", "demo"]
    publishable_key: str | None
    currency: str
