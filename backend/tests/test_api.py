from conftest import DROP, PICKUP


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


# ---------- auth ----------
def test_register_login_me(client):
    r = client.post("/api/auth/register", json={"name": "Asha", "email": "asha@test.com", "password": "secret123"})
    assert r.status_code == 201
    assert r.json()["user"]["wallet_balance"] == 100  # welcome bonus
    r = client.post("/api/auth/login", json={"email": "asha@test.com", "password": "secret123"})
    assert r.status_code == 200
    token = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["email"] == "asha@test.com" and me["role"] == "rider"
    # session verification endpoint
    assert client.post("/api/auth/session", json={"token": token}).status_code == 200


def test_duplicate_email_and_bad_login(client):
    body = {"name": "Dup", "email": "dup@test.com", "password": "secret123"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json=body).status_code == 409
    assert client.post("/api/auth/login", json={"email": "dup@test.com", "password": "nope123"}).status_code == 401


def test_validation_and_auth_required(client):
    assert client.post("/api/auth/register", json={"name": "x", "email": "bad", "password": "1"}).status_code == 422
    assert client.get("/api/rides").status_code == 401


def test_role_protection(client, rider):
    headers, _ = rider
    assert client.post("/api/drivers/status", json={"status": "online", **PICKUP}, headers=headers).status_code == 403


# ---------- estimate & promos ----------
def test_estimate(client, rider):
    headers, _ = rider
    r = client.get("/api/rides/estimate", params={"origin": "12.9716,77.5946", "dest": "12.9352,77.6245"}, headers=headers)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["distance_meters"] > 1000
    fares = {o["vehicle_type"]: o["fare"] for o in data["options"]}
    assert fares["bike"] < fares["auto"] < fares["mini"] < fares["sedan"] < fares["suv"]


def test_estimate_with_promo(client, rider):
    headers, _ = rider
    r = client.get("/api/rides/estimate", params={"origin": "12.9716,77.5946", "dest": "12.9352,77.6245",
                                                  "promo": "gocab20"}, headers=headers).json()
    assert r["promo_applied"] == "GOCAB20"
    assert all(o["discount"] > 0 for o in r["options"])


def test_promo_validate(client, rider):
    headers, _ = rider
    ok = client.post("/api/promos/validate", json={"code": "FLAT40", "fare": 200}, headers=headers).json()
    assert ok["valid"] and ok["discount"] == 40
    low = client.post("/api/promos/validate", json={"code": "FLAT40", "fare": 100}, headers=headers).json()
    assert not low["valid"]
    bad = client.post("/api/promos/validate", json={"code": "NOPE", "fare": 100}, headers=headers).json()
    assert not bad["valid"]
    assert len(client.get("/api/promos").json()) >= 3


# ---------- full ride lifecycle ----------
def test_full_ride_flow(client, rider, driver):
    rh, ru = rider
    dh, du = driver
    r = client.post("/api/rides/request", json={"pickup": PICKUP, "drop": DROP, "pickup_address": "MG Road",
                                               "drop_address": "Koramangala", "vehicle_type": "mini",
                                               "payment_method": "cash", "promo_code": "welcome50"}, headers=rh)
    assert r.status_code == 201, r.text
    ride = r.json()
    assert ride["status"] == "requested" and ride["discount"] > 0 and len(ride["otp"]) == 4
    otp = ride["otp"]

    # cannot book a second ride while one is active
    assert client.post("/api/rides/request", json={"pickup": PICKUP, "drop": DROP}, headers=rh).status_code == 409

    # driver sees the request (without OTP) and accepts
    reqs = client.get("/api/drivers/requests", headers=dh).json()
    assert any(x["id"] == ride["id"] and x["otp"] is None for x in reqs)
    acc = client.post(f"/api/rides/{ride['id']}/accept", headers=dh)
    assert acc.status_code == 200 and acc.json()["status"] == "accepted"
    assert client.post(f"/api/rides/{ride['id']}/accept", headers=dh).status_code == 409

    # rider sees driver + vehicle
    view = client.get(f"/api/rides/{ride['id']}", headers=rh).json()
    assert view["driver"]["id"] == du["id"] and view["vehicle"]["vehicle_number"] == "KA01ZZ0001"

    # location updates via REST
    assert client.post("/api/drivers/location", json={"lat": 12.97, "lng": 77.595}, headers=dh).status_code == 200
    assert client.get(f"/api/rides/{ride['id']}/status", headers=rh).json()["driver_location"]["lat"] == 12.97

    assert client.post(f"/api/rides/{ride['id']}/arrived", headers=dh).json()["status"] == "arrived"
    assert client.post(f"/api/rides/{ride['id']}/start", json={"otp": "9999" if otp != "9999" else "1111"}, headers=dh).status_code == 400
    assert client.post(f"/api/rides/{ride['id']}/start", json={"otp": otp}, headers=dh).json()["status"] == "started"
    done = client.post(f"/api/rides/{ride['id']}/complete", headers=dh).json()
    assert done["status"] == "completed" and done["payment_status"] == "paid"
    assert done["fare_actual"] == done["fare_estimate"] - done["discount"]

    # receipt
    pdf = client.get(f"/api/rides/{ride['id']}/receipt", headers=rh)
    assert pdf.status_code == 200 and pdf.content[:4] == b"%PDF"
    assert client.post(f"/api/rides/{ride['id']}/email-receipt", headers=rh).json()["queued"]

    # history
    assert client.get("/api/rides", headers=rh).json()[0]["id"] == ride["id"]
    assert client.get("/api/rides", headers=dh).json()[0]["id"] == ride["id"]

    # reviews + aggregation
    assert client.post("/api/reviews", json={"ride_id": ride["id"], "rating": 4, "comment": "Nice"}, headers=rh).status_code == 201
    assert client.post("/api/reviews", json={"ride_id": ride["id"], "rating": 5}, headers=rh).status_code == 409
    assert client.post("/api/reviews", json={"ride_id": ride["id"], "rating": 5}, headers=dh).status_code == 201
    summary = client.get(f"/api/reviews/user/{du['id']}", headers=rh).json()
    assert summary["count"] == 1 and summary["average"] == 4 and summary["distribution"]["4"] == 1
    assert client.get("/api/auth/me", headers=dh).json()["rating_avg"] == 4

    # driver earnings
    stats = client.get("/api/drivers/stats", headers=dh).json()
    assert stats["trips_total"] == 1 and stats["total"] > 0


def test_wallet_payment_and_topup(client, rider, driver):
    rh, _ = rider
    dh, _ = driver
    top = client.post("/api/wallet/topup", json={"amount": 500}, headers=rh).json()
    assert top["mode"] == "demo" and top["status"] == "succeeded"
    w = client.get("/api/wallet", headers=rh).json()
    assert w["balance"] == 100 + 500 + 25  # bonus + topup + 5% cashback
    ride = client.post("/api/rides/request", json={"pickup": PICKUP, "drop": DROP, "payment_method": "wallet"}, headers=rh).json()
    client.post(f"/api/rides/{ride['id']}/accept", headers=dh)
    client.post(f"/api/rides/{ride['id']}/start", json={"otp": ride["otp"]}, headers=dh)
    done = client.post(f"/api/rides/{ride['id']}/complete", headers=dh).json()
    assert done["payment_status"] == "paid"
    assert client.get("/api/wallet", headers=rh).json()["balance"] == round(625 - done["fare_actual"], 2)


def test_card_payment_demo_mode(client, rider, driver):
    rh, _ = rider
    dh, _ = driver
    ride = client.post("/api/rides/request", json={"pickup": PICKUP, "drop": DROP, "payment_method": "card"}, headers=rh).json()
    assert client.post(f"/api/payments/ride/{ride['id']}/intent", headers=rh).status_code == 409  # not completed
    client.post(f"/api/rides/{ride['id']}/accept", headers=dh)
    client.post(f"/api/rides/{ride['id']}/start", json={"otp": ride["otp"]}, headers=dh)
    assert client.post(f"/api/rides/{ride['id']}/complete", headers=dh).json()["payment_status"] == "pending"
    pay = client.post(f"/api/payments/ride/{ride['id']}/intent", headers=rh).json()
    assert pay["status"] == "succeeded"
    assert client.get(f"/api/rides/{ride['id']}", headers=rh).json()["payment_status"] == "paid"


def test_cancel_and_decline(client, rider, driver):
    rh, _ = rider
    dh, _ = driver
    ride = client.post("/api/rides/request", json={"pickup": PICKUP, "drop": DROP}, headers=rh).json()
    assert client.post(f"/api/rides/{ride['id']}/decline", headers=dh).json()["ok"]
    assert all(x["id"] != ride["id"] for x in client.get("/api/drivers/requests", headers=dh).json())
    c = client.post(f"/api/rides/{ride['id']}/cancel", json={"reason": "Changed plans"}, headers=rh).json()
    assert c["status"] == "cancelled" and c["cancelled_by"] == "rider"


def test_driver_backs_out_returns_ride_to_pool(client, rider, driver):
    rh, _ = rider
    dh, _ = driver
    ride = client.post("/api/rides/request", json={"pickup": PICKUP, "drop": DROP}, headers=rh).json()
    client.post(f"/api/rides/{ride['id']}/accept", headers=dh)
    back = client.post(f"/api/rides/{ride['id']}/cancel", headers=dh).json()
    assert back["status"] == "requested" and back["driver_id"] is None
    client.post(f"/api/rides/{ride['id']}/cancel", headers=rh)


def test_nearby_drivers(client, rider, driver):
    rh, _ = rider
    near = client.get("/api/drivers/nearby", params=PICKUP, headers=rh).json()
    assert any(d["vehicle_type"] == "mini" for d in near)


def test_stripe_webhook_unknown_intent(client):
    r = client.post("/api/webhooks/stripe", json={"type": "payment_intent.succeeded", "data": {"object": {"id": "pi_x"}}})
    assert r.status_code == 200 and r.json()["result"].startswith("ignored")


def test_websocket_auth_and_ping(client, rider):
    import pytest
    from starlette.websockets import WebSocketDisconnect

    rh, ru = rider
    token = rh["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/rider/{ru['id']}?token={token}") as ws:
        assert ws.receive_json()["type"] == "connected"
        ws.send_json({"type": "ping"})
        assert ws.receive_json()["type"] == "pong"
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/ws/rider/{ru['id']}?token=bad") as ws:
            ws.receive_json()


def test_driver_receives_realtime_request(client, rider, driver):
    rh, _ = rider
    dh, du = driver
    token = dh["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/driver/{du['id']}?token={token}") as ws:
        assert ws.receive_json()["type"] == "connected"
        ride = client.post("/api/rides/request", json={"pickup": PICKUP, "drop": DROP}, headers=rh).json()
        msg = ws.receive_json()
        assert msg["type"] == "ride_request" and msg["ride"]["id"] == ride["id"]
    client.post(f"/api/rides/{ride['id']}/cancel", headers=rh)
