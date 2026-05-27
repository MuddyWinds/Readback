"""Versioned migration runner: applies, records, idempotent, upgrade-safe.

Runs against a real temp-file SQLite database - the same reflection-based code
path the runner uses on Postgres.
"""

import pytest
import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine

from backend.db.migrations.runner import MIGRATIONS, run_migrations

# Schema as it existed *before* any of the migrated columns were added.
_BASE_TABLE = """
CREATE TABLE analysis_results (
    id INTEGER PRIMARY KEY,
    chunk_id INTEGER,
    timestamp TIMESTAMP,
    airport_code VARCHAR(10),
    transcript TEXT,
    assessable BOOLEAN,
    assessable_confidence FLOAT,
    is_standard BOOLEAN,
    observations JSON,
    summary TEXT,
    confidence_score FLOAT
)
"""


def _columns(conn, table):
    return {c["name"] for c in sa.inspect(conn).get_columns(table)}


def _versions(conn):
    return {r[0] for r in conn.execute(sa.text("SELECT version_id FROM schema_migrations"))}


@pytest.mark.anyio
async def test_fresh_db_applies_all_steps_and_records(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path}/fresh.db")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(lambda c: c.execute(sa.text(_BASE_TABLE)))
        await run_migrations(engine)
        async with engine.connect() as conn:
            cols = await conn.run_sync(lambda c: _columns(c, "analysis_results"))
            versions = await conn.run_sync(_versions)
    finally:
        await engine.dispose()

    assert versions == {v for v, _, _ in MIGRATIONS}
    assert {"enrichment", "status", "reviewer_notes"} <= cols
