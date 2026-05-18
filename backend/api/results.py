"""Results endpoints: read history, update investigation status/notes, stats."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db
from backend.db.models import AnalysisResultDB
from backend.analysis.categorizer import build_stats
from backend.models.schemas import AnalysisResult, Observation

router = APIRouter()

_VALID_STATUSES = {"new", "under_review", "confirmed", "false_positive"}


def _row_to_dict(r: AnalysisResultDB) -> dict:
    return {
        "id": r.id,
        "timestamp": r.timestamp.isoformat(),
        "airport_code": r.airport_code,
        "transcript": r.transcript,
        "assessable": r.assessable if r.assessable is not None else True,
        "assessable_confidence": r.assessable_confidence or 1.0,
        "is_standard": r.is_standard,
        "observations": r.observations,
        "summary": r.summary,
        "confidence_score": r.confidence_score,
        "enrichment": r.enrichment,
        "status": r.status or "new",
        "reviewer_notes": r.reviewer_notes,
    }


@router.get("/api/results")
async def get_results(
    limit: int = 500,
    offset: int = 0,
    airport: str | None = None,
    start_date: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AnalysisResultDB).order_by(desc(AnalysisResultDB.timestamp))
    if airport:
        query = query.where(AnalysisResultDB.airport_code == airport.upper())
    if start_date:
        dt = datetime.fromisoformat(start_date.replace("Z", ""))
        query = query.where(AnalysisResultDB.timestamp >= dt)
    rows = await db.execute(query.offset(offset).limit(limit))
    return [_row_to_dict(r) for r in rows.scalars().all()]


class ResultUpdate(BaseModel):
    status: str | None = None
    reviewer_notes: str | None = None


@router.patch("/api/results/{result_id}")
async def update_result(
    result_id: int,
    update: ResultUpdate,
    db: AsyncSession = Depends(get_db),
):
    row = await db.get(AnalysisResultDB, result_id)
    if not row:
        raise HTTPException(status_code=404, detail="Result not found")
    if update.status is not None:
        if update.status not in _VALID_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {update.status}")
        row.status = update.status
    if update.reviewer_notes is not None:
        row.reviewer_notes = update.reviewer_notes
    await db.commit()
    return {"ok": True, "id": result_id}


@router.get("/api/stats")
async def get_stats(
    airport: str | None = None,
    start_date: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AnalysisResultDB).order_by(desc(AnalysisResultDB.timestamp)).limit(2000)
    if airport:
        query = query.where(AnalysisResultDB.airport_code == airport.upper())
    if start_date:
        dt = datetime.fromisoformat(start_date.replace("Z", ""))
        query = query.where(AnalysisResultDB.timestamp >= dt)
    rows = await db.execute(query)
    results = [
        AnalysisResult(
            timestamp=r.timestamp,
            airport_code=r.airport_code,
            transcript=r.transcript,
            is_standard=r.is_standard,
            observations=[Observation(**v) for v in (r.observations or [])],
            summary=r.summary,
            confidence_score=r.confidence_score,
        )
        for r in rows.scalars().all()
    ]
    return build_stats(results)


@router.get("/api/airports")
async def get_airports(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(distinct(AnalysisResultDB.airport_code)))
    return sorted(rows.scalars().all())
