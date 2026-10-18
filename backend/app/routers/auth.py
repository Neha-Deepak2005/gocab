from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Driver, Role, User, WalletTransaction
from ..schemas import DriverUpdate, LoginIn, RegisterIn, SessionIn, TokenOut, UserOut, UserUpdate
from ..security import create_access_token, get_current_user, hash_password, user_from_token, verify_password

router = APIRouter(prefix="/api", tags=["auth & users"])

SIGNUP_BONUS = 100.0


@router.post("/auth/register", response_model=TokenOut, status_code=201)
def register(data: RegisterIn, db: Session = Depends(get_db)):
    email = data.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, "An account with this email already exists")
    user = User(name=data.name.strip(), email=email, phone=data.phone, role=data.role,
                password_hash=hash_password(data.password))
    db.add(user)
    db.flush()
    if data.role == Role.DRIVER:
        db.add(Driver(user_id=user.id, vehicle_type=data.vehicle_type or "mini",
                      vehicle_model=data.vehicle_model or "", vehicle_number=(data.vehicle_number or "").upper(),
                      vehicle_color=data.vehicle_color or "", verified=True))
    else:
        user.wallet_balance = SIGNUP_BONUS
        db.add(WalletTransaction(user_id=user.id, amount=SIGNUP_BONUS, kind="bonus", description="Welcome bonus 🎉"))
    db.commit()
    db.refresh(user)
    return TokenOut(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.post("/auth/login", response_model=TokenOut)
def login(data: LoginIn, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(401, "Incorrect email or password")
    return TokenOut(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.post("/auth/session", response_model=TokenOut)
def session(data: SessionIn, db: Session = Depends(get_db)):
    """Verify a token (GoCab JWT or Supabase access token) and return the user + a GoCab token."""
    user = user_from_token(data.token, db, create_external=True)
    if not user:
        raise HTTPException(401, "Invalid token")
    return TokenOut(access_token=create_access_token(user), user=UserOut.model_validate(user))


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("/users/me", response_model=UserOut)
def update_me(data: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(user, k, v)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/drivers/me", response_model=UserOut)
def update_vehicle(data: DriverUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    drv = db.get(Driver, user.id)
    if not drv:
        raise HTTPException(400, "Not a driver account")
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(drv, k, v.upper() if k == "vehicle_number" and v else v)
    db.commit()
    db.refresh(user)
    return user
