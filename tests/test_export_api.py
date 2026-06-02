import csv
import importlib
import io
import json
import sys
from datetime import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

EXPORT_COLUMNS = [
    "id",
    "timestamp",
    "airport_code",
    "callsign",
    "assessable",
    "is_standard",
    "status",
    "severity_max",
    "note_types",
    "summary",
    "transcript",
]


def _load_export_api(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.api.results", "backend.api.export"):
        sys.modules.pop(mod, None)
    return importlib.import_module("backend.api.export")


async def _sessionmaker(tmp_path):
    from backend.db.models import Base

    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/ex.db")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return async_sessionmaker(engine, expire_on_commit=False)


async def _seed(sm, n=3):
    from backend.db.models import AnalysisResultDB

    async with sm() as session:
        for i in range(n):
            session.add(
                AnalysisResultDB(
                    timestamp=datetime(2026, 5, 20, i + 1),
                    airport_code="KSFO",
                    transcript=f"t{i}",
                    callsign="AAL123",
                    assessable=True,
                    is_standard=True,
                    status="new",
                    observations=[],
                    summary="s",
                    confidence_score=0.9,
                )
            )
        await session.commit()


async def _read_stream(resp):
    parts = []
    async for chunk in resp.body_iterator:
        parts.append(chunk if isinstance(chunk, str) else chunk.decode())
    return "".join(parts)


@pytest.mark.anyio
async def test_export_csv_header_and_rows(monkeypatch, tmp_path):
    export_api = _load_export_api(monkeypatch)
    sm = await _sessionmaker(tmp_path)
    await _seed(sm, 3)

    async with sm() as session:
        resp = await export_api.export_results(format="csv", db=session)

    assert "text/csv" in resp.media_type
    assert "attachment" in resp.headers.get("content-disposition", "")
    rows = list(csv.reader(io.StringIO(await _read_stream(resp))))
    assert rows[0] == EXPORT_COLUMNS
    assert len(rows) - 1 == 3


@pytest.mark.anyio
async def test_export_json(monkeypatch, tmp_path):
    export_api = _load_export_api(monkeypatch)
    sm = await _sessionmaker(tmp_path)
    await _seed(sm, 2)

    async with sm() as session:
        resp = await export_api.export_results(format="json", db=session)

    data = json.loads(resp.body)
    assert isinstance(data, list)
    assert len(data) == 2


@pytest.mark.anyio
async def test_export_rejects_bad_format(monkeypatch, tmp_path):
    export_api = _load_export_api(monkeypatch)
    sm = await _sessionmaker(tmp_path)

    async with sm() as session:
        with pytest.raises(HTTPException) as exc:
            await export_api.export_results(format="xml", db=session)

    assert exc.value.status_code == 400
