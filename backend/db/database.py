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


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session
