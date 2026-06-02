from __future__ import annotations

"""Results endpoints: read history, update investigation status/notes, stats."""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from backend.db.database import get_db
from backend.db.models import AnalysisResultDB
from backend.analysis.categorizer import build_stats
from backend.models.schemas import AnalysisResult, Observation, _iso_utc

router = APIRouter()

_VALID_STATUSES = {"new", "under_review", "confirmed", "false_positive"}


def _safe_observations(raw) -> list[Observation]:
    """Parse stored observations, skipping any that don't fit the current schema.

    Historically the read path did ``[Observation(**v) for v in raw]`` and
    raised on the first stray row from a since-changed Gemini emission —
    poisoning ``/api/stats`` for the entire batch. Skip the bad ones instead.
    """
    out: list[Observation] = []
    for v in (raw or []):
        if not isinstance(v, dict):
            continue
        try:
            out.append(Observation(**v))
        except Exception:
            continue
    return out


def _row_to_dict(r: AnalysisResultDB) -> dict:
    return {
        "id": r.id,
        "timestamp": _iso_utc(r.timestamp) if r.timestamp is not None else None,
        "airport_code": r.airport_code,
        "transcript": r.transcript,
        "assessable": r.assessable if r.assessable is not None else True,
        "assessable_confidence": r.assessable_confidence or 1.0,
        "is_standard": r.is_standard,
        "observations": [o.model_dump() for o in _safe_observations(r.observations)],
        "summary": r.summary,
        "confidence_score": r.confidence_score,
        "enrichment": r.enrichment,
        "status": r.status or "new",
        "reviewer_notes": r.reviewer_notes,
    }


def _row_to_analysis_result(r: AnalysisResultDB) -> AnalysisResult:
    return AnalysisResult(
        timestamp=r.timestamp,
        airport_code=r.airport_code,
        transcript=r.transcript,
        assessable=r.assessable if r.assessable is not None else True,
        assessable_confidence=r.assessable_confidence if r.assessable_confidence is not None else 1.0,
        is_standard=r.is_standard,
        observations=_safe_observations(r.observations),
        summary=r.summary,
        confidence_score=r.confidence_score,
    )


@router.get("/api/results")
async def get_results(
    limit: int = 500,
    offset: int = 0,
    airport: Optional[str] = None,
    start_date: Optional[str] = None,
    status: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
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
    rows = await db.execute(query.offset(offset).limit(limit))
    return [_row_to_dict(r) for r in rows.scalars().all()]


class ResultUpdate(BaseModel):
    status: Optional[str] = None
    reviewer_notes: Optional[str] = None


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
    airport: Optional[str] = None,
    start_date: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AnalysisResultDB).order_by(desc(AnalysisResultDB.timestamp)).limit(2000)
    if airport:
        query = query.where(AnalysisResultDB.airport_code == airport.upper())
    if start_date:
        dt = datetime.fromisoformat(start_date.replace("Z", ""))
        query = query.where(AnalysisResultDB.timestamp >= dt)
    rows = await db.execute(query)
    results = [_row_to_analysis_result(r) for r in rows.scalars().all()]
    return build_stats(results)


@router.get("/api/airports")
async def get_airports(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(distinct(AnalysisResultDB.airport_code)))
    return sorted(rows.scalars().all())
