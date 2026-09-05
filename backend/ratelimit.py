"""Redis-backed fixed-window rate limiting (audit.md A11).

A per-IP / per-user HTTP throttle that sits in front of sensitive endpoints. This
is Tier 1 (flood protection) and is independent of the business quota system
(Tier 2, services/quota.py) which caps render/clip *counts* per day/month.

Keying: authenticated requests key by the JWT `sub` (user id) so a user can't
dodge limits by rotating IPs; unauthenticated requests (login/register) key by the
real client IP, which the Next.js proxy forwards via X-Forwarded-For.

Fail-open by design: if Redis is unavailable the limiter allows the request rather
than taking the whole API down. Availability of the limiter must never be a single
point of failure for the app.
"""

from __future__ import annotations

import jwt
from fastapi import HTTPException, Request

import redis.asyncio as aioredis

from config import settings

_redis: aioredis.Redis | None = None


def _client() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis


def _identity(request: Request) -> str:
    """Prefer the authenticated user id; fall back to the forwarded client IP.

    The JWT is only *decoded* (not verified against the DB) purely to derive a
    stable throttle key — a forged token still can't pass get_current_user on the
    actual endpoint, so weak keying here has no security impact."""
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        token = auth[7:]
        try:
            payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
            sub = payload.get("sub")
            if sub:
                return f"u:{sub}"
        except jwt.InvalidTokenError:
            pass
    # X-Forwarded-For is set by the Next proxy; take the first (client) hop.
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return f"ip:{xff.split(',')[0].strip()}"
    return f"ip:{request.client.host if request.client else 'unknown'}"


def rate_limit(scope: str, limit: int, window_seconds: int):
    """Dependency factory. `scope` namespaces the counter so different routes
    don't share a budget. Fixed-window: first hit in a window sets the TTL."""

    async def dependency(request: Request):
        key = f"rl:{scope}:{_identity(request)}"
        try:
            r = _client()
            count = await r.incr(key)
            if count == 1:
                await r.expire(key, window_seconds)
            if count > limit:
                ttl = await r.ttl(key)
                raise HTTPException(
                    status_code=429,
                    detail=f"Rate limit exceeded — try again in {max(1, ttl)}s",
                    headers={"Retry-After": str(max(1, ttl))},
                )
        except HTTPException:
            raise
        except Exception:
            # Fail open — never let a Redis hiccup 500 the API.
            return

    return dependency
