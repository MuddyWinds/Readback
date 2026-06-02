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
async def test_callsign_backfill_populates_and_is_idempotent(monkeypatch, tmp_path):
    _reload(monkeypatch)
    from backend.db.models import Base
    from backend.db.migrations.runner import run_migrations

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/bf.db")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.execute(
                sa.text(
                    "INSERT INTO analysis_results (transcript, callsign, is_standard) "
                    "VALUES ('AAL123 contact ground', NULL, 1)"
                )
            )
        await run_migrations(engine)
        async with engine.begin() as conn:
            cs = (await conn.execute(sa.text("SELECT callsign FROM analysis_results"))).scalar_one()
        assert cs == "AAL123"

        await run_migrations(engine)
        async with engine.begin() as conn:
            cs2 = (await conn.execute(sa.text("SELECT callsign FROM analysis_results"))).scalar_one()
        assert cs2 == "AAL123"
    finally:
        await engine.dispose()
