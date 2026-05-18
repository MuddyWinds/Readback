from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from backend.config import settings
from backend.db.models import Base

# Convert postgresql:// → postgresql+asyncpg:// (SQLite URLs passed through as-is)
if settings.DATABASE_URL.startswith("postgresql://"):
    async_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
else:
    async_url = settings.DATABASE_URL

engine = create_async_engine(async_url, echo=False)
AsyncSessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migrate: add columns to existing SQLite databases
        for migration in [
            "ALTER TABLE analysis_results ADD COLUMN enrichment TEXT",
            "ALTER TABLE analysis_results ADD COLUMN status TEXT DEFAULT 'new'",
            "ALTER TABLE analysis_results ADD COLUMN reviewer_notes TEXT",
        ]:
            try:
                await conn.execute(text(migration))
            except Exception:
                pass  # Column already exists


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
