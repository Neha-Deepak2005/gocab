import os
import sys
from pathlib import Path

os.environ.setdefault("DATABASE_URL", "sqlite:///./test_gocab.db")
os.environ["DEMO_BOTS"] = "false"
os.environ["USE_OSRM"] = "false"        # deterministic straight-line routing, no network
os.environ["STRIPE_SECRET_KEY"] = ""
os.environ["REDIS_URL"] = ""
os.environ["RATE_LIMIT_PER_MINUTE"] = "100000"
os.environ["AUTH_RATE_LIMIT_PER_MINUTE"] = "100000"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

PICKUP = {"lat": 12.9716, "lng": 77.5946}
DROP = {"lat": 12.9352, "lng": 77.6245}


@pytest.fixture(scope="session")
def client():
    if Path("test_gocab.db").exists():
        Path("test_gocab.db").unlink()
    from app.main import app

    with TestClient(app) as c:
        yield c
    Path("test_gocab.db").unlink(missing_ok=True)


_counter = {"n": 0}


def _register(client, role="rider", **extra):
    _counter["n"] += 1
    body = {"name": f"Test {role} {_counter['n']}", "email": f"{role}{_counter['n']}@test.com",
            "password": "secret123", "role": role, **extra}
    r = client.post("/api/auth/register", json=body)
    assert r.status_code == 201, r.text
    data = r.json()
    return {"Authorization": f"Bearer {data['access_token']}"}, data["user"]


@pytest.fixture
def rider(client):
    return _register(client, "rider")


@pytest.fixture
def driver(client):
    headers, user = _register(client, "driver", vehicle_type="mini", vehicle_model="Swift", vehicle_number="ka01zz0001")
    r = client.post("/api/drivers/status", json={"status": "online", **PICKUP}, headers=headers)
    assert r.status_code == 200, r.text
    return headers, user
