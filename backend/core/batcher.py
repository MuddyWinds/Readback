"""
Background workers:
  run_batcher()  — drains transcript_queue every BATCH_INTERVAL_SECONDS,
                   sends one Gemini call covering all airports, persists results.
  run_monitor()  — streams audio for a single airport feed, transcribes chunks,
                   pushes them to transcript_queue.
"""

import asyncio
import traceback
from datetime import datetime

import httpx

from backend.config import settings
from backend.core.state import adsb_snapshots, broadcast, transcript_queue
from backend.db.database import AsyncSessionLocal
from backend.db.models import AnalysisResultDB, TranscriptChunkDB
from backend.analysis.compliance import analyze_batch
from backend.ingestion.audio_stream import stream_audio_chunks
from backend.ingestion.transcriber import transcribe
from backend.models.schemas import AnalysisResult

BATCH_INTERVAL_SECONDS = 240  # flush to Gemini every 4 minutes

# Airport reference coordinates used for ADS-B bounding-box queries
AIRPORT_GEO: dict[str, tuple[float, float]] = {
    "KJFK": (40.64, -73.78),
    "KATL": (33.64, -84.43),
    "VHHH": (22.31, 113.92),
    "KLAX": (33.94, -118.41),
    "KORD": (41.97, -87.91),
}

_VIOLATION_KEYWORDS = [
    "mayday", "pan pan", "emergency", "declare",
    "go around", "go-around", "missed approach", "abort", "rejected takeoff",
    "runway incursion", "stop stop stop", "hold position", "cancel takeoff",
    "cleared to land", "cleared for takeoff",
    "altitude", "leaving", "unable", "negative", "say again", "correction",
    "traffic alert", "tcas", "resolution advisory",
    "minimum fuel", "fuel emergency", "engine",
]


def _needs_analysis(transcript: str) -> bool:
    t = transcript.lower()
    return any(kw in t for kw in _VIOLATION_KEYWORDS)


async def _fetch_adsb_snapshot(airports: set[str]) -> dict[str, list]:
    """Fetch ADS-B states for every airport in the batch concurrently."""
    results: dict[str, list] = {}

    async def fetch_one(code: str) -> None:
        geo = AIRPORT_GEO.get(code)
        if not geo:
            return
        lat, lon = geo
        url = (
            f"https://opensky-network.org/api/states/all"
            f"?lamin={lat-1.5}&lomin={lon-3.0}&lamax={lat+1.5}&lomax={lon+3.0}"
        )
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(url)
                raw = resp.json()
            results[code] = [
                {
                    "icao24": s[0], "callsign": (s[1] or "").strip() or None,
                    "latitude": s[6], "longitude": s[5],
                    "altitude_m": s[7], "on_ground": s[8],
                    "velocity_ms": s[9], "heading": s[10], "squawk": s[14],
                }
                for s in (raw.get("states") or []) if len(s) >= 17
            ]
        except Exception as exc:
            print(f"[Batcher] ADS-B fetch failed for {code}: {exc}", flush=True)

    await asyncio.gather(*(fetch_one(code) for code in airports))
    return results


async def _persist_batch(
    pairs: list[tuple[dict, AnalysisResult]],
    batch_adsb: dict[str, list],
) -> None:
    """Write all results to SQLite and broadcast each one via WebSocket."""
    async with AsyncSessionLocal() as session:
        for item, result in pairs:
            chunk_row = TranscriptChunkDB(
                timestamp=result.timestamp,
                airport_code=result.airport_code,
                feed_url="",
                raw_text=item["transcript"],
                duration_seconds=settings.CHUNK_DURATION_SECONDS,
            )
            session.add(chunk_row)
            await session.flush()

            result_row = AnalysisResultDB(
                chunk_id=chunk_row.id,
                timestamp=result.timestamp,
                airport_code=result.airport_code,
                transcript=item["transcript"],
                assessable=result.assessable,
                assessable_confidence=result.assessable_confidence,
                is_compliant=result.is_compliant,
                violations=[v.model_dump() for v in result.violations],
                summary=result.summary,
                confidence_score=result.confidence_score,
                enrichment=result.enrichment,
            )
            session.add(result_row)
            await session.flush()

            if result_row.id and result.airport_code in batch_adsb:
                adsb_snapshots[result_row.id] = {
                    "airport": result.airport_code,
                    "captured_at": result.timestamp.isoformat(),
                    "aircraft": batch_adsb[result.airport_code],
                }

            await broadcast({
                "type": "analysis",
                "data": {**result.model_dump(mode="json"), "id": result_row.id, "status": "new"},
            })

        await session.commit()


async def run_batcher() -> None:
    """Every BATCH_INTERVAL_SECONDS, drain the transcript queue and run one Gemini call."""
    print(f"[Batcher] Started — flushing every {BATCH_INTERVAL_SECONDS}s", flush=True)
    await asyncio.sleep(30)  # let feeds warm up

    while True:
        items: list[dict] = []
        while not transcript_queue.empty():
            items.append(transcript_queue.get_nowait())
        # Cap at 15 per batch to keep Gemini token usage predictable
        if len(items) > 15:
            overflow = items[15:]
            items = items[:15]
            for it in overflow:  # re-queue the rest for next cycle
                transcript_queue.put_nowait(it)

        if not items:
            print("[Batcher] No transcripts queued — skipping", flush=True)
            await asyncio.sleep(BATCH_INTERVAL_SECONDS)
            continue

        stt_bad  = [it for it in items if not it.get("stt_assessable", True)]
        stt_good = [it for it in items if it.get("stt_assessable", True)]
        pairs: list[tuple[dict, AnalysisResult]] = []

        for it in stt_bad:
            pairs.append((it, AnalysisResult(
                timestamp=it["timestamp"],
                airport_code=it["airport_code"],
                transcript=it["transcript"],
                assessable=False,
                assessable_confidence=it.get("assessable_confidence", 0.0),
                is_compliant=True,
                violations=[],
                summary=it.get("stt_reason") or "Audio quality too low for reliable transcription",
                confidence_score=0.0,
            )))

        if stt_good:
            print(f"[Batcher] Sending {len(stt_good)} transcript(s) to Gemini...", flush=True)
            try:
                gemini_results = await analyze_batch(stt_good)
                pairs.extend(zip(stt_good, gemini_results))
            except Exception as exc:
                print(f"[Batcher] Gemini batch failed: {exc}", flush=True)
                await asyncio.sleep(BATCH_INTERVAL_SECONDS)
                continue

        batch_adsb = await _fetch_adsb_snapshot({it["airport_code"] for it in items})

        print(f"[Batcher] Persisting {len(pairs)} result(s)...", flush=True)
        await _persist_batch(pairs, batch_adsb)
        print(f"[Batcher] Done — broadcast {len(pairs)} result(s)", flush=True)

        await asyncio.sleep(BATCH_INTERVAL_SECONDS)


async def run_monitor(feed_url: str, airport_code: str, start_delay: float = 0) -> None:
    """Transcribe audio chunks from one feed and push to the shared queue."""
    if start_delay:
        await asyncio.sleep(start_delay)
    print(f"[{airport_code}] Monitor started: {feed_url}", flush=True)
    try:
        loop = asyncio.get_event_loop()
        async for audio_chunk in stream_audio_chunks(feed_url, settings.CHUNK_DURATION_SECONDS):
            print(f"[{airport_code}] Got chunk ({len(audio_chunk)} samples), transcribing...", flush=True)
            result = await loop.run_in_executor(None, transcribe, audio_chunk)
            transcript = result["text"]

            if not result["assessable"]:
                print(f"[{airport_code}] STT unassessable — {result['reason']}", flush=True)
                await transcript_queue.put({
                    "airport_code": airport_code,
                    "transcript": transcript or "[audio not assessable]",
                    "timestamp": datetime.utcnow(),
                    "stt_assessable": False,
                    "stt_reason": result["reason"],
                    "assessable_confidence": max(0.0, 1.0 + result["avg_logprob"]),
                })
                continue

            if not transcript or len(transcript.split()) < 5:
                print(f"[{airport_code}] Transcript too short, skipping", flush=True)
                continue

            print(f"[{airport_code}] Queued: {transcript[:80]}", flush=True)
            await transcript_queue.put({
                "airport_code": airport_code,
                "transcript": transcript,
                "timestamp": datetime.utcnow(),
                "stt_assessable": True,
                "stt_reason": None,
                "assessable_confidence": 1.0,
            })

    except asyncio.CancelledError:
        print(f"[{airport_code}] Monitor stopped.", flush=True)
    except Exception as exc:
        print(f"[{airport_code}] ERROR: {exc}", flush=True)
        traceback.print_exc()
