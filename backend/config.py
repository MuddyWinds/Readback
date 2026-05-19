from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    GEMINI_API_KEY: str
    DATABASE_URL: str = "postgresql://atc:atc@localhost:5432/atcmonitor"
    WHISPER_MODEL: str = "base"  # tiny | base | small | medium | large
    LIVEATC_FEED_URL: str = "http://feeds.liveatc.net/ksfo"
    CHUNK_DURATION_SECONDS: int = 30

    # Speech-to-text resource limits (PR1 — energy/CPU)
    WHISPER_CPU_THREADS: int = 0   # threads per transcription; 0 = CTranslate2 default
    STT_CONCURRENCY: int = 1       # max simultaneous transcriptions across all feeds

    class Config:
        env_file = ".env"


settings = Settings()
