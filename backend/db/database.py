from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.config import settings
from backend.db.migrations.runner import run_migrations
from backend.db.models import Base

# Convert postgresql:// -> postgresql+asyncpg:// (SQLite URLs passed through as-is)
if settings.DATABASE_URL.startswith("postgresql://"):
    async_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
else:
    async_url = settings.DATABASE_URL

engine = create_async_engine(async_url, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await run_migrations(engine)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
