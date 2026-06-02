from __future__ import annotations

"""
Background workers:
  run_batcher()  — drains transcript_queue every BATCH_INTERVAL_SECONDS,
                   sends one Gemini call covering all airports, persists results.
  run_monitor()  — streams audio for a single airport feed, transcribes chunks,
                   pushes them to transcript_queue.
"""

import asyncio
import traceback
from datetime import timedelta

import httpx

from backend.config import settings
from backend.core.airports import airport_geo
from backend.core.callsign import extract_callsign
from backend.core.settings_store import current_runtime
from backend.core.state import (
    broadcast,
    mark_feed,
    pipeline_status,
    transcript_queue,
    utc_iso,
    utc_now_naive,
)
from backend.db.database import AsyncSessionLocal
from backend.db.models import AnalysisResultDB
from backend.analysis.phraseology import analyze_batch
from backend.ingestion.audio_stream import stream_audio_chunks
from backend.ingestion.silence_gate import should_transcribe
from backend.ingestion.transcriber import get_stt_executor, transcribe
from backend.models.schemas import AnalysisResult

BATCH_INTERVAL_SECONDS = 300  # flush to Gemini every 5 minutes
IDLE_POLL_SECONDS = 30        # while waiting for first transcripts, check more often

def _batch_interval() -> int:
    return current_runtime().batch_interval_seconds or BATCH_INTERVAL_SECONDS


def _set_next_batch(seconds: int | None = None) -> None:
    seconds = seconds if seconds is not None else _batch_interval()
    pipeline_status["next_batch_at"] = (utc_now_naive() + timedelta(seconds=seconds)).isoformat() + "Z"


def _order_items_for_batch(items: list[dict]) -> list[dict]:
    """Order batch items by (airport_code, timestamp) so any cross-transcript
    attribution the model performs is chronological and within one airport.
    Returns a new list; does not mutate the input."""
    return sorted(items, key=lambda it: (it["airport_code"], it["timestamp"]))


def _gemini_failure_pairs(items: list[dict], exc: Exception) -> list[tuple[dict, AnalysisResult]]:
    summary = (
        "Analysis temporarily unavailable: Gemini returned an error while this "
        f"transcript batch was being analyzed ({exc}). The transcript was captured "
        "and preserved for manual review."
    )
    return [
        (it, AnalysisResult(
            timestamp=it["timestamp"],
            airport_code=it["airport_code"],
            transcript=it["transcript"],
            assessable=False,
            assessable_confidence=it.get("stt_confidence", 0.0),
            is_standard=True,
            observations=[],
            summary=summary,
            confidence_score=0.0,
        ))
        for it in items
    ]


def _batch_assessability_summary(pairs: list[tuple[dict, AnalysisResult]]) -> dict:
    """Coverage/quality counts for one persisted batch (rollout instrumentation).

    `gemini_unassessable` counts only results where Gemini actually judged the text
    and returned unassessable. Outage/omission fallbacks are flagged with
    `analysis_failed` on the item and counted separately as `analysis_unavailable`,
    so a provider outage cannot masquerade as a text-quality problem (review #2).
    `low_conf_routed` is how many items we sent to Gemini despite low STT confidence.
    """
    total = len(pairs)
    assessable = sum(1 for _, r in pairs if r.assessable)
    analysis_unavailable = sum(1 for it, _ in pairs if it.get("analysis_failed"))
    gemini_unassessable = sum(
        1 for it, r in pairs
        if not r.assessable and not it.get("analysis_failed") and it.get("stt_assessable", True)
    )
    low_conf = sum(1 for it, _ in pairs if it.get("stt_confidence", 1.0) < 0.4)
    return {
        "total": total,
        "assessable": assessable,
        "gemini_unassessable": gemini_unassessable,
        "analysis_unavailable": analysis_unavailable,
        "low_conf_routed": low_conf,
    }


async def _fetch_adsb_snapshot(airports: set[str]) -> dict[str, list]:
    """Fetch ADS-B states for every airport in the batch concurrently."""
    results: dict[str, list] = {}

    async def fetch_one(code: str) -> None:
        geo = airport_geo(code)
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
    """Write all results to the configured database, then broadcast each one via WebSocket.

    Broadcasting only happens after the transaction commits successfully —
    otherwise clients could receive an ``id`` that gets rolled back, and any
    later PATCH against it would 404.
    """
    broadcast_payloads: list[dict] = []
    async with AsyncSessionLocal() as session:
        for item, result in pairs:
            result_row = AnalysisResultDB(
                timestamp=result.timestamp,
                airport_code=result.airport_code,
                callsign=extract_callsign(item["transcript"]),
                transcript=item["transcript"],
                assessable=result.assessable,
                assessable_confidence=result.assessable_confidence,
                is_standard=result.is_standard,
                observations=[v.model_dump() for v in result.observations],
                summary=result.summary,
                confidence_score=result.confidence_score,
                enrichment=result.enrichment,
            )
            session.add(result_row)
            await session.flush()

            if result.airport_code in batch_adsb:
                result_row.adsb_snapshot = {
                    "airport": result.airport_code,
                    "captured_at": result.timestamp.isoformat() + "Z",
                    "aircraft": batch_adsb[result.airport_code],
                }

            broadcast_payloads.append({
                "type": "analysis",
                "data": {**result.model_dump(mode="json"), "id": result_row.id, "status": "new"},
            })

        await session.commit()

    for payload in broadcast_payloads:
        await broadcast(payload)


async def run_batcher() -> None:
    """Every BATCH_INTERVAL_SECONDS, drain the transcript queue and run one Gemini call."""
    print(f"[Batcher] Started — flushing every {_batch_interval()}s", flush=True)
    _set_next_batch(30)
    await asyncio.sleep(30)  # let feeds warm up

    while True:
        pipeline_status["last_error"] = None
        pipeline_status["last_batch_started_at"] = utc_iso()
        items: list[dict] = []
        while not transcript_queue.empty():
            items.append(transcript_queue.get_nowait())
        # Order by (airport, timestamp) BEFORE capping so each airport's chunks
        # stay chronologically contiguous and the cap overflows the sorted tail,
        # not an arbitrary FIFO tail (which could strand an instruction away from
        # its read-back). Cap at 15 to keep Gemini token usage predictable.
        items = _order_items_for_batch(items)
        if len(items) > 15:
            overflow = items[15:]
            items = items[:15]
            for it in overflow:  # re-queue the sorted tail for next cycle
                transcript_queue.put_nowait(it)

        if not items:
            print("[Batcher] No transcripts queued — skipping", flush=True)
            pipeline_status["last_batch_completed_at"] = utc_iso()
            pipeline_status["last_persisted_count"] = 0
            _set_next_batch(IDLE_POLL_SECONDS)
            await broadcast({"type": "pipeline", "data": get_pipeline_snapshot()})
            await asyncio.sleep(IDLE_POLL_SECONDS)
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
                assessable_confidence=it.get("stt_confidence", 0.0),
                is_standard=True,
                observations=[],
                summary=it.get("stt_reason") or "Audio quality too low for reliable transcription",
                confidence_score=0.0,
            )))

        if stt_good:
            print(f"[Batcher] Sending {len(stt_good)} transcript(s) to Gemini...", flush=True)
            try:
                gemini_results = await analyze_batch(stt_good)
                pairs.extend(zip(stt_good, gemini_results))
                pipeline_status["last_gemini_error"] = None
            except Exception as exc:
                print(f"[Batcher] Gemini batch failed: {exc}", flush=True)
                pipeline_status["last_gemini_error"] = str(exc)
                for it in stt_good:
                    it["analysis_failed"] = True
                pairs.extend(_gemini_failure_pairs(stt_good, exc))

        batch_adsb = await _fetch_adsb_snapshot({it["airport_code"] for it in items})

        summary = _batch_assessability_summary(pairs)
        pipeline_status["last_batch_assessability"] = summary
        print(f"[Batcher] assessability {summary}", flush=True)
        # One structured line per low-confidence routed item: airport, stt_conf, word
        # density, and the Gemini verdict together — the signal the validation gate
        # consumes (spec Rollout / review #1). Skip outage fallbacks (no real verdict).
        for it, r in pairs:
            if it.get("stt_confidence", 1.0) < 0.4 and not it.get("analysis_failed"):
                print(
                    f"[Batcher] low-conf verdict: airport={it['airport_code']} "
                    f"stt_conf={it.get('stt_confidence', 0.0):.2f} "
                    f"wps={it.get('words_per_speech_second', 0.0):.1f} "
                    f"assessable={r.assessable}",
                    flush=True,
                )

        print(f"[Batcher] Persisting {len(pairs)} result(s)...", flush=True)
        await _persist_batch(pairs, batch_adsb)
        pipeline_status["last_batch_completed_at"] = utc_iso()
        pipeline_status["last_persisted_count"] = len(pairs)
        _set_next_batch()
        await broadcast({"type": "pipeline", "data": get_pipeline_snapshot()})
        print(f"[Batcher] Done — broadcast {len(pairs)} result(s)", flush=True)

        await asyncio.sleep(_batch_interval())


async def run_monitor(feed_url: str, airport_code: str, start_delay: float = 0) -> None:
    """Transcribe audio chunks from one feed and push to the shared queue."""
    if start_delay:
        await asyncio.sleep(start_delay)
    print(f"[{airport_code}] Monitor started: {feed_url}", flush=True)
    mark_feed(feed_url, airport_code, "starting")
    try:
        loop = asyncio.get_running_loop()
        async for audio_chunk in stream_audio_chunks(feed_url, settings.CHUNK_DURATION_SECONDS):
            pipeline_status["last_audio_at"] = utc_iso()
            mark_feed(feed_url, airport_code, "audio")
            # Framed-RMS pre-gate — skip Whisper entirely on silent chunks.
            passed, rms_stats = should_transcribe(audio_chunk, current_runtime().stt_rms_threshold)
            if not passed:
                print(
                    f"[{airport_code}] Silence-gated, skipping "
                    f"(max_rms={rms_stats['max_rms']:.4f}, p95={rms_stats['p95_rms']:.4f})",
                    flush=True,
                )
                mark_feed(feed_url, airport_code, "silent", f"max_rms={rms_stats['max_rms']:.4f}")
                continue

            print(
                f"[{airport_code}] Got chunk ({len(audio_chunk)} samples, "
                f"max_rms={rms_stats['max_rms']:.4f}), transcribing...",
                flush=True,
            )
            mark_feed(feed_url, airport_code, "transcribing")
            # Bounded STT pool — caps concurrent Whisper jobs at STT_CONCURRENCY
            result = await loop.run_in_executor(get_stt_executor(), transcribe, audio_chunk)
            transcript = result["text"]

            if not result["assessable"]:
                reason = result["reason"] or ""
                # Count hallucination rejections for rollout instrumentation
                # (spec Rollout). pipeline_status is surfaced via get_pipeline_snapshot.
                if "hallucination" in reason.lower():
                    pipeline_status["hallucination_skips"] = (
                        pipeline_status.get("hallucination_skips", 0) + 1
                    )
                # No recoverable speech or a likely hallucination: skip silently —
                # no card. (Spec: stop carding no-speech chunks.)
                print(f"[{airport_code}] Skipped — {reason}", flush=True)
                mark_feed(feed_url, airport_code, "skipped", reason)
                continue

            if not transcript or len(transcript.split()) < 5:
                print(f"[{airport_code}] Transcript too short, skipping", flush=True)
                mark_feed(feed_url, airport_code, "too_short")
                continue

            # Carry word density on the item so the post-Gemini validation log
            # (Task 5) can emit ONE structured line with the Gemini verdict —
            # rather than correlating two separate prints (review #1).
            wps = result["word_count"] / max(result["speech_seconds"], 0.5)
            print(f"[{airport_code}] Queued: {transcript[:80]}", flush=True)
            await transcript_queue.put({
                "airport_code": airport_code,
                "transcript": transcript,
                "timestamp": utc_now_naive(),
                "stt_assessable": True,
                "stt_reason": None,
                "stt_confidence": result["stt_confidence"],
                "words_per_speech_second": wps,
            })
            pipeline_status["last_transcript_at"] = utc_iso()
            mark_feed(feed_url, airport_code, "queued", f"{transcript[:80]}")

    except asyncio.CancelledError:
        print(f"[{airport_code}] Monitor stopped.", flush=True)
        mark_feed(feed_url, airport_code, "stopped")
    except Exception as exc:
        print(f"[{airport_code}] ERROR: {exc}", flush=True)
        pipeline_status["last_error"] = f"{airport_code}: {exc}"
        mark_feed(feed_url, airport_code, "error", str(exc))
        traceback.print_exc()


def get_pipeline_snapshot() -> dict:
    return {
        **pipeline_status,
        "queued_transcripts": transcript_queue.qsize(),
        "batch_interval_seconds": _batch_interval(),
    }
