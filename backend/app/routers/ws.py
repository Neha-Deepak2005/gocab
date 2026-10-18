"""WebSocket endpoints.

ws /ws/rider/{rider_id}?token=...   rider watches their ride (status + live driver location)
ws /ws/driver/{driver_id}?token=... driver receives ride requests, sends {"type":"location","lat":..,"lng":..}
"""
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from ..database import SessionLocal
from ..models import Driver
from ..security import user_from_token
from ..services.realtime import hub
from .drivers import relay_location

router = APIRouter(tags=["realtime"])


def _auth(token: str | None, expected_id: int, role: str):
    if not token:
        return None
    with SessionLocal() as db:
        user = user_from_token(token, db)
        if user and user.id == expected_id and (user.role == role or user.role == "admin"):
            return user
    return None


def _save_location(driver_id: int, lat: float, lng: float) -> None:
    with SessionLocal() as db:
        d = db.get(Driver, driver_id)
        if d:
            d.lat, d.lng = lat, lng
            d.location_updated_at = datetime.now(timezone.utc)
            db.commit()
            relay_location(db, driver_id, lat, lng)


async def _session(ws: WebSocket, user_id: int, role: str):
    user = await run_in_threadpool(_auth, ws.query_params.get("token"), user_id, role)
    if not user:
        await ws.close(code=4401)
        return
    await hub.connect(user_id, ws)
    await ws.send_json({"type": "connected", "role": role})
    try:
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "ping":
                await ws.send_json({"type": "pong"})
            elif kind == "location" and role == "driver":
                try:
                    lat, lng = float(msg["lat"]), float(msg["lng"])
                    if -90 <= lat <= 90 and -180 <= lng <= 180:
                        await run_in_threadpool(_save_location, user_id, lat, lng)
                except (KeyError, TypeError, ValueError):
                    await ws.send_json({"type": "error", "detail": "bad location"})
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        hub.disconnect(user_id, ws)


@router.websocket("/ws/rider/{rider_id}")
async def rider_ws(ws: WebSocket, rider_id: int):
    await _session(ws, rider_id, "rider")


@router.websocket("/ws/driver/{driver_id}")
async def driver_ws(ws: WebSocket, driver_id: int):
    await _session(ws, driver_id, "driver")
