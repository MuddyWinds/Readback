from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.api.results import _VALID_STATUSES, _safe_observations
from backend.db.database import get_db
from backend.db.models import AnalysisResultDB

router = APIRouter()

_SEVERITY_RANK = {"critical": 4, "high": 3, "medium": 2, "low": 1}
_COLUMNS = [
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
_MAX_ROWS = 50000


def _row_fields(row: AnalysisResultDB) -> dict:
    observations = _safe_observations(row.observations)
    severity_max = max(
        (obs.significance.value for obs in observations),
        key=lambda s: _SEVERITY_RANK.get(s, 0),
        default="",
    )
    note_types = ";".join(sorted({obs.note_type.value for obs in observations}))
    return {
        "id": row.id,
        "timestamp": row.timestamp.isoformat() if row.timestamp else "",
        "airport_code": row.airport_code or "",
        "callsign": row.callsign or "",
        "assessable": row.assessable if row.assessable is not None else True,
        "is_standard": row.is_standard,
        "status": row.status or "new",
        "severity_max": severity_max,
        "note_types": note_types,
        "summary": row.summary or "",
        "transcript": row.transcript or "",
    }


@router.get("/api/export")
async def export_results(
    format: str = "csv",
    airport: Optional[str] = None,
    start_date: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    if format not in {"csv", "json"}:
        raise HTTPException(status_code=400, detail="format must be csv or json")
    if status is not None and status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {status}")

    query = select(AnalysisResultDB).order_by(desc(AnalysisResultDB.timestamp))
    if airport:
        query = query.where(AnalysisResultDB.airport_code == airport.upper())
    if start_date:
        dt = datetime.fromisoformat(start_date.replace("Z", ""))
        query = query.where(AnalysisResultDB.timestamp >= dt)
    if status:
        query = query.where(AnalysisResultDB.status == status)

    rows = (await db.execute(query.limit(_MAX_ROWS))).scalars().all()
    records = [_row_fields(row) for row in rows]
    stamp = datetime.utcnow().strftime("%Y%m%d")

    if format == "json":
        return JSONResponse(records)

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=_COLUMNS)
    writer.writeheader()
    writer.writerows(records)
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="readback_{stamp}.csv"'},
    )
