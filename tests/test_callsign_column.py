import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine


def _reload(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.db.database"):
        sys.modules.pop(mod, None)


@pytest.mark.anyio
async def test_callsign_column_and_index_exist(monkeypatch, tmp_path):
    _reload(monkeypatch)
    from backend.db.models import Base
    from backend.db.migrations.runner import run_migrations

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/c.db")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await run_migrations(engine)
        async with engine.begin() as conn:
            cols = await conn.run_sync(
                lambda c: {x["name"] for x in sa.inspect(c).get_columns("analysis_results")}
            )
            idx = await conn.run_sync(
                lambda c: {i["name"] for i in sa.inspect(c).get_indexes("analysis_results")}
            )
    finally:
        await engine.dispose()

    assert "callsign" in cols
    assert any("callsign" in name for name in idx)
