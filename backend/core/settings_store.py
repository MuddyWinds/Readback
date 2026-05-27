from __future__ import annotations

from typing import Optional

from backend.config import settings as env_settings
from backend.core.airports import resolve_airport
from backend.db.database import AsyncSessionLocal
from backend.db.models import AppSettingsDB
from backend.models.settings_schemas import AppSettings, FeedConfig, RuntimeConfig

_SETTINGS_ROW_ID = 1
_cache: Optional[AppSettings] = None


def _env_default() -> AppSettings:
    return AppSettings(
        gemini_api_key=env_settings.GEMINI_API_KEY or "",
        feeds=[],
        runtime=RuntimeConfig(
            batch_interval_seconds=300,
            stt_rms_threshold=env_settings.STT_RMS_THRESHOLD,
            whisper_model=env_settings.WHISPER_MODEL,
            stt_concurrency=env_settings.STT_CONCURRENCY,
        ),
    )


def _resolve(s: AppSettings) -> AppSettings:
    resolved_feeds = []
    for f in s.feeds:
        info = resolve_airport(f.airport_code)
        resolved_feeds.append(f.model_copy(update={
            "lat": info["lat"] if info else None,
            "lon": info["lon"] if info else None,
            "name": info["name"] if info else None,
            "runways": info["runways"] if info else [],
        }))
    return s.model_copy(update={"feeds": resolved_feeds})


def _merge_env_fallback(stored: AppSettings) -> AppSettings:
    if not stored.gemini_api_key:
        stored = stored.model_copy(update={"gemini_api_key": env_settings.GEMINI_API_KEY or ""})
    return stored


async def load_settings() -> AppSettings:
    global _cache
    async with AsyncSessionLocal() as session:
        row = await session.get(AppSettingsDB, _SETTINGS_ROW_ID)
    if row and row.data:
        _cache = _resolve(_merge_env_fallback(AppSettings(**row.data)))
    else:
        _cache = _resolve(_env_default())
    return _cache


async def save_settings(payload: AppSettings) -> AppSettings:
    global _cache
    to_store = payload.model_dump()
    async with AsyncSessionLocal() as session:
        row = await session.get(AppSettingsDB, _SETTINGS_ROW_ID)
        if row is None:
            session.add(AppSettingsDB(id=_SETTINGS_ROW_ID, data=to_store))
        else:
            row.data = to_store
        await session.commit()
    _cache = _resolve(_merge_env_fallback(payload))
    return _cache


def get_cached() -> AppSettings:
    return _cache if _cache is not None else _resolve(_env_default())


def current_gemini_key() -> str:
    return get_cached().gemini_api_key or env_settings.GEMINI_API_KEY or ""


def current_feeds() -> list[FeedConfig]:
    return get_cached().feeds


def current_runtime() -> RuntimeConfig:
    return get_cached().runtime
