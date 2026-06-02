import importlib
import sys
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine


def _load_results_api(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.api.results"):
        sys.modules.pop(mod, None)
    return importlib.import_module("backend.api.results")


async def _sessionmaker(tmp_path):
    from backend.db.models import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/t.db")
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
                    transcript="a",
                    assessable=True,
                    is_standard=True,
                    status="new",
                    observations=[],
                    summary="s",
                    confidence_score=0.9,
                ),
                AnalysisResultDB(
                    timestamp=datetime(2026, 5, 20, 2),
                    airport_code="KSFO",
                    transcript="b",
                    assessable=True,
                    is_standard=False,
                    status="new",
                    observations=[],
                    summary="s",
                    confidence_score=0.9,
                ),
                AnalysisResultDB(
                    timestamp=datetime(2026, 5, 20, 3),
                    airport_code="KSFO",
                    transcript="c",
                    assessable=True,
                    is_standard=False,
                    status="confirmed",
                    observations=[],
                    summary="s",
                    confidence_score=0.9,
                ),
            ]
        )
        await session.commit()


@pytest.mark.anyio
async def test_results_status_filter(monkeypatch, tmp_path):
    results_api = _load_results_api(monkeypatch)
    sm = await _sessionmaker(tmp_path)
    await _seed(sm)

    async with sm() as session:
        rows = await results_api.get_results(status="new", db=session)

    assert len(rows) == 2
    assert all(r["status"] == "new" for r in rows)


@pytest.mark.anyio
async def test_results_status_filter_rejects_invalid(monkeypatch, tmp_path):
    results_api = _load_results_api(monkeypatch)
    sm = await _sessionmaker(tmp_path)

    async with sm() as session:
        with pytest.raises(HTTPException) as exc:
            await results_api.get_results(status="bogus", db=session)

    assert exc.value.status_code == 400
