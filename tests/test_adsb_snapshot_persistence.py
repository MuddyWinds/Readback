"""ADS-B snapshots persist on the result row and survive a fresh DB session."""

import importlib
import sys
from datetime import datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.db.models import AnalysisResultDB


def test_model_has_adsb_snapshot_column():
    assert "adsb_snapshot" in AnalysisResultDB.__table__.columns


async def _sqlite_sessionmaker(tmp_path, name):
    """A SQLite-backed sessionmaker with the current schema created."""
    from backend.db.models import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/{name}.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


def _reload_backend(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in (
        "backend.config",
        "backend.db.database",
        "backend.core.batcher",
        "backend.api.aviation_data",
    ):
        sys.modules.pop(mod, None)


@pytest.mark.anyio
async def test_snapshot_survives_into_a_fresh_session(monkeypatch, tmp_path):
    _reload_backend(monkeypatch)
    from backend.db.models import AnalysisResultDB
    from backend.models.schemas import AnalysisResult

    engine, Session = await _sqlite_sessionmaker(tmp_path, "snap")
    try:
        batcher = importlib.import_module("backend.core.batcher")
        aviation = importlib.import_module("backend.api.aviation_data")
        monkeypatch.setattr(batcher, "AsyncSessionLocal", Session)
        monkeypatch.setattr(aviation, "AsyncSessionLocal", Session)

        async def _noop(_data):
            return None

        monkeypatch.setattr(batcher, "broadcast", _noop)

        result = AnalysisResult(
            timestamp=datetime(2026, 5, 20, 1, 0),
            airport_code="KJFK",
            transcript="climb and maintain flight level 350",
            is_standard=True,
            observations=[],
            summary="ok",
            confidence_score=0.9,
        )
        aircraft = [{"icao24": "abc123", "callsign": "DAL1", "altitude_m": 10000}]

        await batcher._persist_batch(
            [({"transcript": result.transcript}, result)],
            {"KJFK": aircraft},
        )

        async with Session() as s:
            row = (await s.execute(sa.select(AnalysisResultDB))).scalars().first()
            result_id = row.id

        # Endpoint opens its *own* session via AsyncSessionLocal - a different
        # session than the writer, proving the read comes from the DB row.
        snap = await aviation.get_adsb_snapshot(result_id)
    finally:
        await engine.dispose()

    assert snap["airport"] == "KJFK"
    assert snap["captured_at"] == "2026-05-20T01:00:00"
    assert snap["aircraft"] == aircraft


@pytest.mark.anyio
async def test_missing_snapshot_returns_no_snapshot_shape(monkeypatch, tmp_path):
    _reload_backend(monkeypatch)
    from backend.db.models import AnalysisResultDB

    engine, Session = await _sqlite_sessionmaker(tmp_path, "nosnap")
    try:
        aviation = importlib.import_module("backend.api.aviation_data")
        monkeypatch.setattr(aviation, "AsyncSessionLocal", Session)

        async with Session() as s:
            s.add(AnalysisResultDB(airport_code="KJFK", is_standard=True))
            await s.commit()
            rid = (await s.execute(sa.select(AnalysisResultDB))).scalars().first().id

        snap = await aviation.get_adsb_snapshot(rid)
    finally:
        await engine.dispose()

    assert snap == {"error": "No snapshot available for this result", "aircraft": []}
