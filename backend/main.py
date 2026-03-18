"""
FastAPI application — ATC Compliance Monitor MVP
Exposes:
  GET  /api/results          — paginated history
  GET  /api/stats            — aggregate stats
  POST /api/monitor/start    — start monitoring a feed
  POST /api/monitor/stop     — stop monitoring
  WS   /ws/live              — real-time analysis stream
"""

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from backend.config import settings
from backend.db.database import init_db, get_db
from backend.db.models import AnalysisResultDB, TranscriptChunkDB
from backend.ingestion.audio_stream import stream_audio_chunks
from backend.ingestion.transcriber import transcribe
from backend.analysis.compliance import analyze_transcript
from backend.analysis.categorizer import build_stats
from backend.models.schemas import AnalysisResult


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="ATC Compliance Monitor", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Active monitor state ───────────────────────────────────────────────────────

monitor_task: asyncio.Task | None = None
active_feed_url: str | None = None
websocket_clients: list[WebSocket] = []


async def broadcast(data: dict):
    for ws in list(websocket_clients):
        try:
            await ws.send_json(data)
        except Exception:
            websocket_clients.remove(ws)


async def run_monitor(feed_url: str, airport_code: str):
    """Core monitoring loop: stream → transcribe → analyze → persist → broadcast."""
    import traceback, logging, asyncio
    log = logging.getLogger("monitor")
    log.info(f"Starting feed: {feed_url}")
    try:
        loop = asyncio.get_event_loop()
        async for audio_chunk in stream_audio_chunks(feed_url, settings.CHUNK_DURATION_SECONDS):
            log.info("Got audio chunk, transcribing...")
            # Run blocking Whisper inference in thread pool so async loop stays free
            transcript = await loop.run_in_executor(None, transcribe, audio_chunk)
            if not transcript:
                log.info("Empty transcript, skipping.")
                continue

            log.info(f"Transcript ({len(transcript)} chars): {transcript[:80]}")
            result: AnalysisResult = await analyze_transcript(transcript, airport_code)

            # Persist
            from backend.db.database import AsyncSessionLocal
            async with AsyncSessionLocal() as session:
                chunk_row = TranscriptChunkDB(
                    timestamp=result.timestamp,
                    airport_code=airport_code,
                    feed_url=feed_url,
                    raw_text=transcript,
                    duration_seconds=settings.CHUNK_DURATION_SECONDS,
                )
                session.add(chunk_row)
                await session.flush()

                result_row = AnalysisResultDB(
                    chunk_id=chunk_row.id,
                    timestamp=result.timestamp,
                    airport_code=airport_code,
                    transcript=transcript,
                    is_compliant=result.is_compliant,
                    violations=[v.model_dump() for v in result.violations],
                    summary=result.summary,
                    confidence_score=result.confidence_score,
                )
                session.add(result_row)
                await session.commit()
                log.info(f"Saved result: compliant={result.is_compliant}, violations={len(result.violations)}")

            # Broadcast to WebSocket clients
            await broadcast({
                "type": "analysis",
                "data": result.model_dump(mode="json"),
            })
    except asyncio.CancelledError:
        log.info("Stopped.")
    except Exception as e:
        log.error(f"ERROR: {e}")
        traceback.print_exc()


# ── REST endpoints ─────────────────────────────────────────────────────────────

@app.get("/api/results")
async def get_results(
    limit: int = 50,
    offset: int = 0,
    airport: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AnalysisResultDB).order_by(desc(AnalysisResultDB.timestamp))
    if airport:
        query = query.where(AnalysisResultDB.airport_code == airport.upper())
    query = query.offset(offset).limit(limit)
    rows = await db.execute(query)
    results = rows.scalars().all()
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat(),
            "airport_code": r.airport_code,
            "transcript": r.transcript,
            "is_compliant": r.is_compliant,
            "violations": r.violations,
            "summary": r.summary,
            "confidence_score": r.confidence_score,
        }
        for r in results
    ]


@app.get("/api/stats")
async def get_stats(
    airport: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(AnalysisResultDB).order_by(desc(AnalysisResultDB.timestamp)).limit(200)
    if airport:
        query = query.where(AnalysisResultDB.airport_code == airport.upper())
    rows = await db.execute(query)
    db_results = rows.scalars().all()

    results = [
        AnalysisResult(
            id=r.id,
            timestamp=r.timestamp,
            airport_code=r.airport_code,
            transcript=r.transcript,
            is_compliant=r.is_compliant,
            violations=[],
            summary=r.summary,
            confidence_score=r.confidence_score,
        )
        for r in db_results
    ]
    return build_stats(results)


@app.post("/api/monitor/start")
async def start_monitor(feed_url: str, airport_code: str = "UNKN"):
    global monitor_task, active_feed_url
    if monitor_task and not monitor_task.done():
        return {"status": "already_running", "feed_url": active_feed_url}
    active_feed_url = feed_url
    monitor_task = asyncio.create_task(run_monitor(feed_url, airport_code.upper()))
    return {"status": "started", "feed_url": feed_url, "airport_code": airport_code.upper()}


@app.post("/api/monitor/stop")
async def stop_monitor():
    global monitor_task, active_feed_url
    if monitor_task and not monitor_task.done():
        monitor_task.cancel()
        active_feed_url = None
        return {"status": "stopped"}
    return {"status": "not_running"}


@app.get("/api/monitor/status")
async def monitor_status():
    running = monitor_task is not None and not monitor_task.done()
    return {"running": running, "feed_url": active_feed_url if running else None}


# ── WebSocket ──────────────────────────────────────────────────────────────────

@app.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    websocket_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep connection alive
    except WebSocketDisconnect:
        websocket_clients.remove(websocket)
