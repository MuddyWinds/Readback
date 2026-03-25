"""Monitor control endpoints and the live WebSocket feed."""

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.core.state import monitor_tasks, websocket_clients
from backend.core.batcher import run_monitor

router = APIRouter()

_feed_start_counter: int = 0


@router.post("/api/monitor/start")
async def start_monitor(feed_url: str, airport_code: str = "UNKN"):
    global _feed_start_counter
    if feed_url in monitor_tasks and not monitor_tasks[feed_url].done():
        return {"status": "already_running", "feed_url": feed_url}
    delay = _feed_start_counter * 15
    _feed_start_counter += 1
    monitor_tasks[feed_url] = asyncio.create_task(
        run_monitor(feed_url, airport_code.upper(), start_delay=delay)
    )
    return {"status": "started", "feed_url": feed_url, "airport_code": airport_code.upper()}


@router.post("/api/monitor/stop")
async def stop_monitor(feed_url: str | None = None):
    global _feed_start_counter
    if feed_url:
        task = monitor_tasks.get(feed_url)
        if task and not task.done():
            task.cancel()
            del monitor_tasks[feed_url]
            return {"status": "stopped", "feed_url": feed_url}
        return {"status": "not_running", "feed_url": feed_url}
    for task in monitor_tasks.values():
        task.cancel()
    monitor_tasks.clear()
    _feed_start_counter = 0
    return {"status": "all_stopped"}


@router.get("/api/monitor/status")
async def monitor_status():
    active = {url: True for url, t in monitor_tasks.items() if not t.done()}
    return {"running": len(active) > 0, "feeds": active}


@router.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    websocket_clients.append(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in websocket_clients:
            websocket_clients.remove(websocket)
