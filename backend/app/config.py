"""Application settings, loaded from environment variables / .env file."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    APP_NAME: str = "GoCab"
    ENV: str = "development"

    # Database: PostgreSQL in production, SQLite fallback for quick local runs
    DATABASE_URL: str = "sqlite:///./gocab.db"

    # Auth
    JWT_SECRET: str = "change-me-in-production-please-32chars"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7
    # Optional: verify Supabase access tokens (Settings -> API -> JWT secret)
    SUPABASE_JWT_SECRET: str | None = None

    # CORS (comma separated)
    CORS_ORIGINS: str = "http://localhost:3000"

    # Redis (pub/sub for realtime, rate limiting, Celery broker). Optional.
    REDIS_URL: str | None = None
    USE_CELERY: bool = False

    # Payments
    STRIPE_SECRET_KEY: str | None = None
    STRIPE_PUBLISHABLE_KEY: str | None = None
    STRIPE_WEBHOOK_SECRET: str | None = None
    CURRENCY: str = "inr"

    # Maps: Google is used when a key is present, otherwise OSRM (free), otherwise straight-line
    GOOGLE_MAPS_API_KEY: str | None = None
    OSRM_URL: str = "https://router.project-osrm.org"
    USE_OSRM: bool = True

    # Geospatial: use PostGIS ST_DWithin for nearby-driver search when running on Postgres+PostGIS
    USE_POSTGIS: bool = False

    # Email receipts (optional)
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str = "GoCab <no-reply@gocab.app>"

    # Demo mode: simulated "bot" drivers accept and drive rides so the app can be demoed solo
    DEMO_BOTS: bool = True
    BOT_ACCEPT_DELAY: float = 6.0
    # when a real driver was notified, give them this long before a bot takes the ride
    BOT_HUMAN_GRACE: float = 30.0
    BOT_SPEED_FACTOR: float = 1.0

    # Rate limiting
    RATE_LIMIT_PER_MINUTE: int = 240
    AUTH_RATE_LIMIT_PER_MINUTE: int = 20

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.STRIPE_SECRET_KEY)

    @property
    def db_url(self) -> str:
        url = self.DATABASE_URL
        # Render/Heroku style URLs -> SQLAlchemy psycopg3 driver
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+psycopg://", 1)
        elif url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+psycopg://", 1)
        return url


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
