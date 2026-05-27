"""
Shared in-process state referenced by both the batcher and the API layer.
Kept in one place so there is a single source of truth for each data structure.

Single-process by design: ``monitor_tasks``, ``transcript_queue``, and
``websocket_clients`` are intentionally process-local - Readback runs as one
worker. Scaling to multiple workers/processes would require externalizing these
(e.g. Redis-backed queue and pub/sub), which is explicitly out of scope.
"""

import asyncio
from datetime import datetime, timezone
from typing import Optional
from fastapi import WebSocket

# Active per-airport monitor tasks, keyed by feed URL
monitor_tasks: dict[str, asyncio.Task] = {}

# Connected WebSocket clients
websocket_clients: list[WebSocket] = []

# Queue of raw transcript dicts waiting for batch Gemini analysis
transcript_queue: asyncio.Queue = asyncio.Queue()

# Lightweight operational telemetry for the dashboard. Kept in-process because
# it describes the current worker loop rather than historical analysis data.
pipeline_status: dict = {
    "last_audio_at": None,
    "last_transcript_at": None,
    "last_batch_started_at": None,
    "last_batch_completed_at": None,
    "next_batch_at": None,
    "last_error": None,
    "last_gemini_error": None,
    "last_persisted_count": 0,
    "feed_status": {},
}


def utc_now_naive() -> datetime:
    """Naive UTC datetime — drop tzinfo to keep DB/Pydantic columns unchanged."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def utc_iso() -> str:
    return utc_now_naive().isoformat() + "Z"


def mark_feed(feed_url: str, airport_code: str, stage: str, detail: Optional[str] = None) -> None:
    pipeline_status["feed_status"][feed_url] = {
        "airport_code": airport_code,
        "stage": stage,
        "detail": detail,
        "updated_at": utc_iso(),
    }


async def broadcast(data: dict) -> None:
    """Send a JSON payload to every connected WebSocket client."""
    for ws in list(websocket_clients):
        try:
            await ws.send_json(data)
        except Exception:
            websocket_clients.remove(ws)
