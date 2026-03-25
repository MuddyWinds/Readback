"""
Shared in-process state referenced by both the batcher and the API layer.
Kept in one place so there is a single source of truth for each data structure.
"""

import asyncio
from fastapi import WebSocket

# Active per-airport monitor tasks, keyed by feed URL
monitor_tasks: dict[str, asyncio.Task] = {}

# Connected WebSocket clients
websocket_clients: list[WebSocket] = []

# Queue of raw transcript dicts waiting for batch Gemini analysis
transcript_queue: asyncio.Queue = asyncio.Queue()

# ADS-B snapshots captured at analysis time, keyed by AnalysisResultDB.id
adsb_snapshots: dict[int, dict] = {}


async def broadcast(data: dict) -> None:
    """Send a JSON payload to every connected WebSocket client."""
    for ws in list(websocket_clients):
        try:
            await ws.send_json(data)
        except Exception:
            websocket_clients.remove(ws)
