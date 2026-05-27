from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class FeedConfig(BaseModel):
    url: str
    airport_code: str
    label: str = ""
    lat: Optional[float] = None
    lon: Optional[float] = None
    name: Optional[str] = None
    runways: list[dict] = Field(default_factory=list)


class RuntimeConfig(BaseModel):
    batch_interval_seconds: int = 300
    stt_rms_threshold: float = 0.0
    whisper_model: str = "base"
    stt_concurrency: int = 1


class AppSettings(BaseModel):
    gemini_api_key: str = ""
    feeds: list[FeedConfig] = Field(default_factory=list)
    runtime: RuntimeConfig = Field(default_factory=RuntimeConfig)


class VerifyFeedRequest(BaseModel):
    url: str
