"""Password hashing, JWT issuing/verification and role-based dependencies.

Tokens accepted by the API:
  * GoCab's own HS256 JWTs (issued by /api/auth/login and /api/auth/register)
  * Supabase access tokens, when SUPABASE_JWT_SECRET is configured. The first time a
    Supabase user calls /api/auth/session a local user row is created for them.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Role, User

bearer = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode()[:72], hashed.encode())
    except ValueError:
        return False


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "iat": now,
        "exp": now + timedelta(minutes=settings.JWT_EXPIRE_MINUTES),
        "iss": "gocab",
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def _decode_supabase(token: str) -> dict | None:
    if not settings.SUPABASE_JWT_SECRET:
        return None
    try:
        return jwt.decode(
            token, settings.SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated"
        )
    except jwt.PyJWTError:
        return None


def user_from_token(token: str, db: Session, create_external: bool = False) -> User | None:
    """Resolve a bearer token to a User (local JWT first, then Supabase)."""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"], issuer="gocab")
        return db.get(User, int(payload["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        pass

    claims = _decode_supabase(token)
    if not claims:
        return None
    user = db.scalar(select(User).where(User.external_id == claims["sub"]))
    if user is None and create_external:
        meta = claims.get("user_metadata") or {}
        email = claims.get("email") or f"{claims['sub']}@supabase.local"
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            role = meta.get("role") if meta.get("role") in (Role.RIDER, Role.DRIVER) else Role.RIDER
            user = User(
                name=meta.get("full_name") or email.split("@")[0],
                email=email,
                role=role,
                auth_provider="supabase",
            )
            db.add(user)
        user.external_id = claims["sub"]
        db.commit()
        db.refresh(user)
    return user


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    user = user_from_token(creds.credentials, db)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token")
    return user


def require_role(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles and user.role != Role.ADMIN:
            raise HTTPException(status.HTTP_403_FORBIDDEN, f"Requires role: {', '.join(roles)}")
        return user

    return checker


get_rider = require_role(Role.RIDER)
get_driver = require_role(Role.DRIVER)
