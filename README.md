# 🚕 GoCab — Cab Booking Platform (Python stack)

A full-stack ride-hailing app: **FastAPI** backend (REST + WebSockets) and a **Next.js + React + Tailwind** frontend.
Riders book bikes, autos and cabs with upfront fares, track their driver live on a map, pay by cash / wallet / card (Stripe),
apply promo codes, download PDF receipts and rate their trips. Drivers go online, receive requests in realtime,
verify the rider's OTP, complete trips and track earnings.

![Landing](docs/screenshots/01_landing.png)

| Booking with promo | Live tracking | Driver dashboard |
|---|---|---|
| ![](docs/screenshots/04_promo.png) | ![](docs/screenshots/06_accepted.png) | ![](docs/screenshots/15_driver_request.png) |

---

## ✅ Features (mapped to the project brief)

| Requirement | Implementation |
|---|---|
| **User authentication** + roles | JWT auth (bcrypt) with rider / driver roles, verified in FastAPI dependencies. `POST /api/auth/session` also verifies **Supabase** access tokens when `SUPABASE_JWT_SECRET` is set. |
| **Ride booking** | `GET /api/rides/estimate` (fares for 5 vehicle classes, ETA, surge) and `POST /api/rides/request`, stored in Postgres. |
| **Fare / distance / time** | Google Directions API when `GOOGLE_MAPS_API_KEY` is set → free **OSRM** routing otherwise → straight-line fallback. |
| **Maps** | Leaflet + OpenStreetMap (CARTO tiles), place search via Nominatim, tap-to-pick on map, route polyline, live car marker. |
| **Driver dashboard & matching** | Online/offline toggle, nearby-driver search (**PostGIS `ST_DWithin`** when enabled, bounding-box + haversine otherwise), accept/decline, arrived → OTP start → complete, earnings chart. |
| **Real-time updates** | FastAPI WebSockets `ws /ws/rider/{id}` and `ws /ws/driver/{id}`; **Redis pub/sub** fan-out across multiple API workers. Live driver location + ETA + status pushes. Polling fallback. |
| **Payments** | **stripe-python** PaymentIntents + Stripe Elements on the frontend, signed **webhook** `POST /api/webhooks/stripe`. Works in *demo mode* without keys. |
| **Ride history & receipts** | History with filters, **PDF receipts** (fpdf2), **Celery** task emails the receipt after each trip. |
| **Ratings & reviews** | Normalized `reviews` table, one review per rider per ride, aggregation (average, count, 1–5★ distribution). |
| **Promo codes & wallet** | Promo table (percent/flat, max discount, min fare, usage limit, expiry). Wallet with top-ups via Stripe, 5% cashback on ₹500+, ₹100 signup bonus, pay rides from wallet. |
| **Security & performance** | Rate limiting (Redis or in-memory), CORS allow-list, Pydantic validation, OTP-verified trip start, row lock on ride accept, DB indexes, GZip. |
| **Background jobs** | Celery worker (receipts) + Celery beat (auto-cancel stale requests). Falls back to background threads when Redis isn't configured. |
| **Testing** | 17 pytest + HTTPX API tests covering auth, roles, estimates, promos, the full ride lifecycle, wallet, payments, cancellation, reviews, WebSockets. |
| **Deployment** | Dockerfiles, `docker-compose.yml` (Postgres+PostGIS, Redis, API, worker, beat, web), Render blueprint, Vercel-ready frontend, GitHub Actions CI. |

**Extras:** surge pricing, demo "bot" drivers (so you can demo the whole flow alone), mobile-responsive UI, driver "simulate drive" button.

---

## 🧱 Architecture

```mermaid
flowchart LR
  subgraph Client
    W[Next.js + Tailwind<br/>Leaflet map, Stripe Elements]
  end
  subgraph Backend
    A[FastAPI<br/>REST + WebSockets]
    C[Celery worker / beat]
  end
  W -- REST / JSON --> A
  W <-- WebSocket --> A
  A --> P[(PostgreSQL + PostGIS)]
  A <--> R[(Redis<br/>pub/sub, rate limit, broker)]
  C <--> R
  C --> P
  A --> S[Stripe API]
  S -- webhook --> A
  A --> G[Google Directions / OSRM]
  C --> M[SMTP email]
```

### Database schema

```mermaid
erDiagram
  users ||--o| drivers : "is"
  users ||--o{ rides : "rides as rider"
  users ||--o{ rides : "drives"
  rides ||--o{ payments : has
  rides ||--o{ reviews : has
  users ||--o{ wallet_transactions : has
  rides ||--o{ ride_declines : has
  users { int id PK; string name; string email UK; string phone; string role; float rating_avg; int rating_count; float wallet_balance }
  drivers { int user_id PK,FK; string vehicle_type; string vehicle_model; string vehicle_number; bool verified; float lat; float lng; string status; bool is_bot }
  rides { int id PK; int rider_id FK; int driver_id FK; float pickup_lat; float pickup_lng; float drop_lat; float drop_lng; string status; float fare_estimate; float discount; float fare_actual; float surge; int distance_meters; int duration_secs; string payment_method; string payment_status; string otp; datetime created_at }
  payments { int id PK; int ride_id FK; int user_id FK; string purpose; string stripe_payment_intent_id; float amount; string status }
  reviews { int id PK; int ride_id FK; int rater_id FK; int rated_id FK; int rating; string comment }
  promos { int id PK; string code UK; string discount_type; float value; float max_discount; float min_fare; int usage_limit; int used_count; datetime expires_at }
  wallet_transactions { int id PK; int user_id FK; float amount; string kind; int ride_id FK }
  ride_declines { int id PK; int ride_id FK; int driver_id FK }
```

Ride status flow: `requested → accepted → arrived → started → completed` (or `cancelled`).

---

## 🚀 Run locally (quickest — no Docker, SQLite)

**Backend** (Python 3.11+):
```bash
cd backend
python -m venv venv && source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload
```
API: http://localhost:8000 · Swagger docs: http://localhost:8000/docs

**Frontend** (Node 18+), in a second terminal:
```bash
cd frontend
npm install
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```
App: http://localhost:3000

### Demo accounts
| Role | Email | Password |
|---|---|---|
| Rider | `rider@gocab.app` | `demo1234` |
| Driver | `driver@gocab.app` | `demo1234` |

Promo codes: `WELCOME50`, `GOCAB20`, `FLAT40`, `WEEKEND`. Stripe test card: `4242 4242 4242 4242`.

**Demo tip:** with `DEMO_BOTS=true`, a simulated driver accepts your ride after ~6 s and drives it live on the map.
To demo the real driver flow, log in as the driver in another browser/incognito window and go online — real drivers get a 30 s head-start before bots step in.

## 🐳 Run the full stack with Docker
```bash
docker compose up --build
```
Starts Postgres + PostGIS, Redis, the API (runs Alembic migrations), Celery worker + beat, and the Next.js app.

## 🧪 Tests
```bash
cd backend && pytest -q                         # SQLite
DATABASE_URL=postgresql://user:pass@localhost/gocab pytest -q   # against Postgres
```

## ☁️ Deploy
See **[DEPLOY.md](DEPLOY.md)**: backend + Postgres on Render (free), frontend on Vercel (free), Stripe webhook setup.

---

## 🔌 API overview
Full interactive docs at `/docs`; the OpenAPI spec is in [`docs/openapi.json`](docs/openapi.json) (import it into Postman via *Import → File*).

| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` · `/api/auth/login` | Create account / log in (returns JWT) |
| POST | `/api/auth/session` | Verify a GoCab or Supabase token |
| GET/PATCH | `/api/auth/me` · `/api/users/me` · `/api/drivers/me` | Profile & vehicle |
| GET | `/api/rides/estimate?origin=lat,lng&dest=lat,lng&promo=` | Fare estimate for all vehicle types |
| POST | `/api/rides/request` | Request a ride |
| GET | `/api/rides` · `/api/rides/active` · `/api/rides/{id}` · `/api/rides/{id}/status` | History, active ride, detail, status |
| POST | `/api/rides/{id}/accept · decline · arrived · start · complete · cancel` | Ride lifecycle |
| GET/POST | `/api/rides/{id}/receipt` · `/api/rides/{id}/email-receipt` | PDF receipt / email via Celery |
| POST | `/api/drivers/status` · `/api/drivers/location` | Go online/offline, update location |
| GET | `/api/drivers/requests` · `/api/drivers/nearby` · `/api/drivers/stats` | Open requests, nearby cars, earnings |
| POST | `/api/payments/ride/{id}/intent` · `/api/payments/{id}/confirm` | Stripe PaymentIntent for a ride |
| POST | `/api/webhooks/stripe` | Stripe webhook (signature verified) |
| GET/POST | `/api/wallet` · `/api/wallet/topup` | Wallet balance, transactions, top-up |
| GET/POST | `/api/promos` · `/api/promos/validate` | Promo codes |
| POST/GET | `/api/reviews` · `/api/reviews/user/{id}` | Post review / aggregated ratings |
| WS | `/ws/rider/{id}?token=` · `/ws/driver/{id}?token=` | Realtime channel |

## 📁 Project structure
```
gocab/
├── backend/
│   ├── app/
│   │   ├── main.py            # FastAPI app, middleware, startup
│   │   ├── config.py          # env settings
│   │   ├── models.py          # SQLAlchemy models
│   │   ├── schemas.py         # Pydantic schemas
│   │   ├── security.py        # JWT / Supabase verification, role guards
│   │   ├── tasks.py           # Celery app + jobs
│   │   ├── seed.py            # demo data
│   │   ├── routers/           # auth, rides, drivers, payments, reviews, ws
│   │   └── services/          # maps, matching, rides, realtime, payments, receipts, ratelimit, simulator
│   ├── alembic/               # migrations (incl. optional PostGIS index)
│   ├── tests/                 # pytest suite
│   └── Dockerfile
├── frontend/
│   ├── app/                   # pages: /, login, register, ride, driver, history, wallet, profile
│   ├── components/            # Map, PlaceInput, PayModal, RateModal, Navbar, ui
│   ├── lib/                   # api client, auth context, websocket hook, geo helpers
│   └── Dockerfile
├── docs/                      # openapi.json, screenshots
├── docker-compose.yml
├── render.yaml
└── DEPLOY.md
```

## ⚙️ Environment variables (backend)
See [`backend/.env.example`](backend/.env.example). Everything except `DATABASE_URL` and `JWT_SECRET` is optional — the app degrades gracefully:
no Stripe keys → demo payments · no Google key → OSRM routing · no Redis → in-process realtime & threads for jobs · no SMTP → receipts logged.
