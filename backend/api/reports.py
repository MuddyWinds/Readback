from __future__ import annotations

"""Aircraft-level Gemini study sheet, aggregating all transmissions for a callsign."""

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from backend.db.database import get_db
from backend.db.models import AnalysisResultDB
from backend.analysis.phraseology import generate_study_sheet
from backend.core.callsign import extract_callsign

router = APIRouter()


@router.get("/api/study-sheet/{result_id}")
async def get_study_sheet(result_id: int, db: AsyncSession = Depends(get_db)):
    row = await db.get(AnalysisResultDB, result_id)
    if not row:
        return {"error": "Result not found"}

    callsign = extract_callsign(row.transcript)
    if not callsign:
        return {"error": "No callsign detected in this transmission"}

    all_rows = await db.execute(select(AnalysisResultDB).order_by(AnalysisResultDB.timestamp))
    related = [r for r in all_rows.scalars().all() if callsign in r.transcript.upper()]
    if not related:
        related = [row]

    threads = [
        {
            "timestamp": r.timestamp.isoformat(),
            "airport_code": r.airport_code,
            "transcript": r.transcript,
            "is_standard": r.is_standard,
            "summary": r.summary,
        }
        for r in related
    ]
    study_sheet = await generate_study_sheet(callsign, threads)
    return {"callsign": callsign, "transmission_count": len(threads), "study_sheet": study_sheet}
