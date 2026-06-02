from __future__ import annotations

"""Aircraft-level Gemini study sheet, aggregating all transmissions for a callsign."""

from fastapi import APIRouter
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from backend.db.database import get_db
from backend.db.models import AnalysisResultDB
from backend.analysis.phraseology import generate_study_sheet
from backend.core.callsign import extract_callsign, normalize_callsign

router = APIRouter()


async def _threads_for_callsign(db: AsyncSession, callsign: str) -> list[dict]:
    rows = await db.execute(
        select(AnalysisResultDB)
        .where(AnalysisResultDB.callsign == callsign)
        .order_by(AnalysisResultDB.timestamp)
    )
    return [
        {
            "timestamp": r.timestamp.isoformat() if r.timestamp else None,
            "airport_code": r.airport_code,
            "transcript": r.transcript,
            "is_standard": r.is_standard,
            "summary": r.summary,
        }
        for r in rows.scalars().all()
    ]


@router.get("/api/study-sheet/{result_id}")
async def get_study_sheet(result_id: int, db: AsyncSession = Depends(get_db)):
    row = await db.get(AnalysisResultDB, result_id)
    if not row:
        return {"error": "Result not found"}

    callsign = row.callsign or extract_callsign(row.transcript or "")
    if not callsign:
        return {"error": "No callsign detected in this transmission"}

    threads = await _threads_for_callsign(db, callsign) or [
        {
            "timestamp": row.timestamp.isoformat() if row.timestamp else None,
            "airport_code": row.airport_code,
            "transcript": row.transcript,
            "is_standard": row.is_standard,
            "summary": row.summary,
        }
    ]
    study_sheet = await generate_study_sheet(callsign, threads)
    return {"callsign": callsign, "transmission_count": len(threads), "study_sheet": study_sheet}


@router.get("/api/study-sheet/by-callsign/{callsign}")
async def get_study_sheet_by_callsign(callsign: str, db: AsyncSession = Depends(get_db)):
    normalized = normalize_callsign(callsign)
    if not normalized:
        return {"error": "Invalid callsign"}
    threads = await _threads_for_callsign(db, normalized)
    if not threads:
        return {"error": "No transmissions for callsign", "callsign": normalized, "transmission_count": 0}
    study_sheet = await generate_study_sheet(normalized, threads)
    return {"callsign": normalized, "transmission_count": len(threads), "study_sheet": study_sheet}


@router.get("/api/callsigns")
async def list_callsigns(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(
        select(AnalysisResultDB.callsign, func.count())
        .where(AnalysisResultDB.callsign.isnot(None))
        .group_by(AnalysisResultDB.callsign)
        .order_by(func.count().desc())
    )
    return [{"callsign": callsign, "count": count} for callsign, count in rows.all()]
