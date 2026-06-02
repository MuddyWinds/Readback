import os

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    GEMINI_API_KEY: str
    DATABASE_URL: str = "postgresql://atc:atc@localhost:5432/atcmonitor"
    WHISPER_MODEL: str = "base"  # tiny | base | small | medium | large
    LIVEATC_FEED_URL: str = "http://feeds.liveatc.net/ksfo"
    CHUNK_DURATION_SECONDS: int = 30

    # Max transmissions batched into one Gemini analysis call. Seeds
    # RuntimeConfig.batch_max_items when no settings row is stored yet.
    BATCH_MAX_ITEMS: int = 40

    # Comma-separated CORS origins for the browser frontend. Default is the CRA
    # dev server; set this (e.g. "https://readback.example.com") to deploy.
    ALLOWED_ORIGINS: str = "http://localhost:3000"

    # Speech-to-text resource limits (PR1 — energy/CPU)
    WHISPER_CPU_THREADS: int = 0   # threads per transcription; 0 = CTranslate2 default
    STT_CONCURRENCY: int = 1       # max simultaneous transcriptions across all feeds

    # Framed-RMS silence pre-gate. 0.0 keeps it disabled until thresholds are
    # calibrated against real feed samples; set >0.0 to skip low-energy chunks.
    STT_RMS_THRESHOLD: float = 0.0
    # faster-whisper's built-in Silero VAD. Off until verified on real LiveATC
    # samples — ATC clips are short, noisy and squelch-heavy.
    WHISPER_VAD_FILTER: bool = False

    @property
    def allowed_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]

    class Config:
        # Tests set READBACK_TEST_ENV=1 (see conftest.py) so settings resolve from
        # real env vars + code defaults only — never a developer's local .env,
        # whose machine-specific CORS origins / DB URL would leak into assertions.
        env_file = None if os.getenv("READBACK_TEST_ENV") else ".env"


settings = Settings()
