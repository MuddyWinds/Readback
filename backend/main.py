"""
Readback — application entry point.

This file is intentionally thin: it wires together the FastAPI app,
registers routers, and starts background workers via the lifespan hook.
All business logic lives in backend/core/ and backend/api/.
"""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.db.database import init_db
from backend.core.batcher import run_batcher
from backend.api import results, monitor, aviation_data, reports


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    batcher = asyncio.create_task(run_batcher())
    yield
    batcher.cancel()


app = FastAPI(title="Readback", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(results.router)
app.include_router(monitor.router)
app.include_router(aviation_data.router)
app.include_router(reports.router)
