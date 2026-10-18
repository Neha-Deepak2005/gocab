"""GoCab API – FastAPI application entrypoint.

Run locally:  uvicorn app.main:app --reload
Docs:         http://localhost:8000/docs
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .config import settings
from .database import Base, engine
from .routers import auth, drivers, payments, reviews, rides, ws
from .seed import seed
from .services.ratelimit import RateLimitMiddleware
from .services.realtime import hub

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Tables are managed by Alembic in production (`alembic upgrade head`);
    # create_all keeps zero-config local/SQLite runs working.
    Base.metadata.create_all(bind=engine)
    seed()
    await hub.start()
    yield
    await hub.stop()


app = FastAPI(
    title="GoCab API",
    version="1.0.0",
    description="Cab booking platform – rides, realtime tracking, payments, wallet, promos, reviews and receipts.",
    lifespan=lifespan,
)

app.add_middleware(RateLimitMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for r in (auth.router, rides.router, drivers.router, payments.router, reviews.router, ws.router):
    app.include_router(r)


@app.get("/", tags=["health"])
def root():
    return {"name": "GoCab API", "status": "ok", "docs": "/docs"}


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "realtime": "redis" if hub.redis else "in-process",
            "payments": "stripe" if settings.stripe_enabled else "demo", "demo_bots": settings.DEMO_BOTS}
