"""Realtime hub for WebSocket connections.

Every connected socket is registered under a key such as "user:12".
`notify(user_id, payload)` can be called from sync endpoint code (threadpool) or async code.

With REDIS_URL set, events are published to a Redis pub/sub channel and every API
worker relays them to its own sockets – so multiple backend instances behind a load
balancer stay in sync. Without Redis, events are delivered in-process.
"""
import asyncio
import json
import logging
from collections import defaultdict

from fastapi import WebSocket

from ..config import settings

log = logging.getLogger(__name__)
CHANNEL = "gocab:events"


class Hub:
    def __init__(self) -> None:
        self.sockets: dict[int, set[WebSocket]] = defaultdict(set)
        self.loop: asyncio.AbstractEventLoop | None = None
        self.redis = None
        self._listener: asyncio.Task | None = None

    async def start(self) -> None:
        self.loop = asyncio.get_running_loop()
        if settings.REDIS_URL:
            try:
                import redis.asyncio as aioredis

                self.redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
                await self.redis.ping()
                self._listener = asyncio.create_task(self._listen())
                log.info("Realtime: using Redis pub/sub")
            except Exception as exc:
                log.warning("Realtime: Redis unavailable (%s); using in-process delivery", exc)
                self.redis = None

    async def stop(self) -> None:
        if self._listener:
            self._listener.cancel()
        if self.redis:
            await self.redis.aclose()

    async def _listen(self) -> None:
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(CHANNEL)
        async for msg in pubsub.listen():
            if msg.get("type") != "message":
                continue
            try:
                data = json.loads(msg["data"])
                await self._deliver(int(data["user_id"]), data["payload"])
            except Exception as exc:
                log.debug("bad pubsub message: %s", exc)

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self.sockets[user_id].add(ws)

    def disconnect(self, user_id: int, ws: WebSocket) -> None:
        self.sockets[user_id].discard(ws)
        if not self.sockets[user_id]:
            self.sockets.pop(user_id, None)

    def is_connected(self, user_id: int) -> bool:
        return bool(self.sockets.get(user_id))

    async def _deliver(self, user_id: int, payload: dict) -> None:
        for ws in list(self.sockets.get(user_id, ())):
            try:
                await ws.send_json(payload)
            except Exception:
                self.disconnect(user_id, ws)

    async def send(self, user_id: int, payload: dict) -> None:
        if self.redis:
            await self.redis.publish(CHANNEL, json.dumps({"user_id": user_id, "payload": payload}, default=str))
        else:
            await self._deliver(user_id, payload)

    def notify(self, user_id: int | None, payload: dict) -> None:
        """Fire-and-forget; safe from both sync (threadpool) and async code."""
        if user_id is None or self.loop is None:
            return
        coro = self.send(user_id, payload)
        try:
            running = asyncio.get_running_loop()
        except RuntimeError:
            running = None
        if running is self.loop:
            asyncio.ensure_future(coro)
        else:
            asyncio.run_coroutine_threadsafe(coro, self.loop)


hub = Hub()
