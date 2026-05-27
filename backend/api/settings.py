from __future__ import annotations

"""Settings endpoints: read/write app settings and probe a feed URL."""

import httpx
from fastapi import APIRouter, HTTPException

from backend.core.airports import suggest_airport_code
from backend.core.feed_allowlist import is_allowed_feed_url
from backend.core.settings_store import load_settings, save_settings
from backend.models.settings_schemas import AppSettings, VerifyFeedRequest

router = APIRouter()

_AUDIO_HINTS = ("audio/", "application/octet-stream", "mpeg")
_MAX_FEEDS = 5


def _looks_like_audio(content_type: str) -> bool:
    ct = (content_type or "").lower()
    return any(hint in ct for hint in _AUDIO_HINTS)


@router.get("/api/settings")
async def get_settings():
    return (await load_settings()).model_dump()


@router.put("/api/settings")
async def put_settings(payload: AppSettings):
    if len(payload.feeds) > _MAX_FEEDS:
        raise HTTPException(status_code=400, detail=f"At most {_MAX_FEEDS} feeds are allowed")
    for f in payload.feeds:
        if not is_allowed_feed_url(f.url):
            raise HTTPException(
                status_code=400,
                detail=f"Feed URL must be on audio.liveatc.net or feeds.liveatc.net: {f.url}",
            )
        if not f.airport_code.strip():
            raise HTTPException(status_code=400, detail="Each feed needs an airport code")
    saved = await save_settings(payload)
    return saved.model_dump()


@router.post("/api/settings/verify-feed")
async def verify_feed(payload: VerifyFeedRequest):
    url = payload.url
    if not is_allowed_feed_url(url):
        return {"ok": False, "reason": "URL must be on audio.liveatc.net or feeds.liveatc.net"}

    try:
        async with httpx.AsyncClient(timeout=6) as client:
            async with client.stream("GET", url, headers={"Range": "bytes=0-2047"}) as resp:
                status = resp.status_code
                content_type = resp.headers.get("content-type", "")
                async for _chunk in resp.aiter_bytes():
                    break
    except Exception as exc:
        return {"ok": False, "reason": f"Unreachable: {exc}", "suggested_code": suggest_airport_code(url)}

    ok = status in (200, 206) and _looks_like_audio(content_type)
    return {
        "ok": ok,
        "status": status,
        "content_type": content_type,
        "suggested_code": suggest_airport_code(url),
        "reason": None if ok else f"Unexpected response ({status}, {content_type or 'no content-type'})",
    }
