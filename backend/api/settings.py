from __future__ import annotations

"""Settings endpoints: read/write app settings and probe a feed URL."""

import httpx
from fastapi import APIRouter, HTTPException

from backend.core.airports import suggest_airport_code
from backend.core.feed_allowlist import is_allowed_feed_url, is_allowed_input_url
from backend.core.feed_url import normalize_feed_url
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
                detail=(
                    "Feed URL must be a normalized LiveATC stream URL on "
                    "audio.liveatc.net or feeds.liveatc.net - use Verify to convert "
                    f"a listen-page link: {f.url}"
                ),
            )
        if not f.airport_code.strip():
            raise HTTPException(status_code=400, detail="Each feed needs an airport code")
    saved = await save_settings(payload)
    return saved.model_dump()


async def _probe(url: str) -> tuple[int, str]:
    """Range-GET a candidate stream URL; return (status, content_type). Raises on network error."""
    async with httpx.AsyncClient(timeout=6) as client:
        async with client.stream("GET", url, headers={"Range": "bytes=0-2047"}) as resp:
            async for _chunk in resp.aiter_bytes():
                break
            return resp.status_code, resp.headers.get("content-type", "")


@router.post("/api/settings/verify-feed")
async def verify_feed(payload: VerifyFeedRequest):
    raw = payload.url
    if not is_allowed_input_url(raw):
        return {
            "ok": False, "stream_url": None,
            "reason": "Enter a LiveATC stream URL (audio/feeds.liveatc.net) "
                      "or a listen-page link (liveatc.net/hlisten.php?mount=...)",
        }

    normalized = normalize_feed_url(raw)
    if not normalized.candidates:
        return {
            "ok": False, "stream_url": None,
            "reason": "Could not find a stream mount in that LiveATC link",
            "suggested_code": normalized.suggested_icao,
        }

    last_reason = "Verification failed"
    for candidate in normalized.candidates:
        try:
            status, content_type = await _probe(candidate)
        except Exception as exc:
            last_reason = f"Unreachable: {exc}"
            continue
        if status in (200, 206) and _looks_like_audio(content_type):
            return {
                "ok": True, "stream_url": candidate, "status": status,
                "content_type": content_type,
                "suggested_code": normalized.suggested_icao or suggest_airport_code(candidate),
                "reason": None,
            }
        last_reason = f"Unexpected response ({status}, {content_type or 'no content-type'})"

    return {
        "ok": False, "stream_url": None, "reason": last_reason,
        "suggested_code": normalized.suggested_icao,
    }
