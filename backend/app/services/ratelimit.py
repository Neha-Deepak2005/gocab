"""Fixed-window rate limiting middleware: Redis when available, in-memory otherwise."""
import time
from collections import defaultdict

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ..config import settings


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        super().__init__(app)
        self.redis = None
        self.memory: dict[str, list] = defaultdict(lambda: [0, 0.0])
        if settings.REDIS_URL:
            try:
                import redis

                self.redis = redis.from_url(settings.REDIS_URL)
                self.redis.ping()
            except Exception:
                self.redis = None

    def _hit(self, key: str) -> int:
        window = int(time.time() // 60)
        if self.redis:
            k = f"rl:{key}:{window}"
            try:
                pipe = self.redis.pipeline()
                pipe.incr(k)
                pipe.expire(k, 61)
                return int(pipe.execute()[0])
            except Exception:
                pass
        bucket = self.memory[key]
        if bucket[1] != window:
            bucket[0], bucket[1] = 0, window
        bucket[0] += 1
        if len(self.memory) > 10_000:
            self.memory.clear()
        return bucket[0]

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api") or path.startswith("/api/webhooks") or request.method == "OPTIONS":
            return await call_next(request)
        ip = request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0].strip()
        is_auth = path.startswith("/api/auth/login") or path.startswith("/api/auth/register")
        limit = settings.AUTH_RATE_LIMIT_PER_MINUTE if is_auth else settings.RATE_LIMIT_PER_MINUTE
        count = self._hit(f"{'auth' if is_auth else 'api'}:{ip}")
        if count > limit:
            return JSONResponse({"detail": "Too many requests – please slow down."}, status_code=429,
                                headers={"Retry-After": "60"})
        return await call_next(request)
