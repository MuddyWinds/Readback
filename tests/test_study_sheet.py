import importlib
import sys
from datetime import datetime

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _load_reports(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.api.reports"):
        sys.modules.pop(mod, None)
    return importlib.import_module("backend.api.reports")


async def _sessionmaker(tmp_path):
    from backend.db.models import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/ss.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False)


async def _seed(sm):
    from backend.db.models import AnalysisResultDB

    async with sm() as session:
        session.add_all(
            [
                AnalysisResultDB(
                    timestamp=datetime(2026, 5, 20, 1),
                    airport_code="KSFO",
                    transcript="AAL123 a",
                    callsign="AAL123",
                    is_standard=True,
                    observations=[],
                    summary="s",
                    confidence_score=0.9,
                ),
                AnalysisResultDB(
                    timestamp=datetime(2026, 5, 20, 2),
                    airport_code="KSFO",
                    transcript="AAL123 b",
                    callsign="AAL123",
                    is_standard=False,
                    observations=[],
                    summary="s",
                    confidence_score=0.9,
                ),
                AnalysisResultDB(
                    timestamp=datetime(2026, 5, 20, 3),
                    airport_code="KSFO",
                    transcript="UAL5 c",
                    callsign="UAL5",
                    is_standard=True,
                    observations=[],
                    summary="s",
                    confidence_score=0.9,
                ),
            ]
        )
        await session.commit()


@pytest.mark.anyio
async def test_study_sheet_by_callsign_aggregates_only_matching(monkeypatch, tmp_path):
    reports = _load_reports(monkeypatch)
    captured = {}

    async def fake_sheet(callsign, threads):
        captured["threads"] = threads
        return "SHEET"

    monkeypatch.setattr(reports, "generate_study_sheet", fake_sheet)

    sm = await _sessionmaker(tmp_path)
    await _seed(sm)
    async with sm() as session:
        out = await reports.get_study_sheet_by_callsign("AAL123", db=session)

    assert out["callsign"] == "AAL123"
    assert out["transmission_count"] == 2
    assert len(captured["threads"]) == 2


@pytest.mark.anyio
async def test_list_callsigns_counts(monkeypatch, tmp_path):
    reports = _load_reports(monkeypatch)
    sm = await _sessionmaker(tmp_path)
    await _seed(sm)

    async with sm() as session:
        rows = await reports.list_callsigns(db=session)

    assert {r["callsign"]: r["count"] for r in rows} == {"AAL123": 2, "UAL5": 1}
