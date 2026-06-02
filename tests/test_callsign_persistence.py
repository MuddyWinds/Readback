import importlib
import sys
from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _reload_backend(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.db.database", "backend.core.batcher"):
        sys.modules.pop(mod, None)


async def _sqlite_sessionmaker(tmp_path, name):
    from backend.db.models import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/{name}.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


@pytest.mark.anyio
async def test_persist_batch_stores_normalized_callsign(monkeypatch, tmp_path):
    _reload_backend(monkeypatch)
    from backend.db.models import AnalysisResultDB
    from backend.models.schemas import AnalysisResult

    engine, Session = await _sqlite_sessionmaker(tmp_path, "cs")
    try:
        batcher = importlib.import_module("backend.core.batcher")
        monkeypatch.setattr(batcher, "AsyncSessionLocal", Session)

        async def _noop(_data):
            return None

        monkeypatch.setattr(batcher, "broadcast", _noop)

        result = AnalysisResult(
            timestamp=datetime(2026, 5, 20, 1, 0),
            airport_code="VHHH",
            transcript="cathay two five zero descend",
            is_standard=True,
            observations=[],
            summary="ok",
            confidence_score=0.9,
        )
        await batcher._persist_batch([({"transcript": result.transcript}, result)], {})

        async with Session() as session:
            row = (await session.execute(sa.select(AnalysisResultDB))).scalars().first()
            assert row.callsign == "CPA250"
    finally:
        await engine.dispose()
