from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    GEMINI_API_KEY: str
    DATABASE_URL: str = "postgresql://atc:atc@localhost:5432/atcmonitor"
    WHISPER_MODEL: str = "base"  # tiny | base | small | medium | large
    LIVEATC_FEED_URL: str = "http://feeds.liveatc.net/ksfo"
    CHUNK_DURATION_SECONDS: int = 30

    class Config:
        env_file = ".env"


settings = Settings()
