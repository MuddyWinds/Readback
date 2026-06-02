"""Versioned, recorded schema migrations for Readback.

Replaces the old inline ``ALTER TABLE ...`` + bare-``except`` block in
``database.py`` with an ordered runner that records what it has applied in a
``schema_migrations`` table and is safe to re-run. Works identically on SQLite
and PostgreSQL: column existence is checked via SQLAlchemy reflection rather
than by parsing backend-specific "duplicate column" errors.

Each step is ``(version_id, description, fn)`` where ``fn`` takes a synchronous
SQLAlchemy ``Connection`` (the runner bridges async to sync via ``run_sync``).
A step and its bookkeeping row commit together; a failing step aborts startup
instead of being silently swallowed.
"""

from __future__ import annotations

from datetime import datetime
from typing import Callable

import sqlalchemy as sa

_SCHEMA_MIGRATIONS_DDL = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    version_id VARCHAR(255) PRIMARY KEY,
    applied_at VARCHAR(64) NOT NULL
)
"""


def _add_column_if_missing(conn, table, column, ddl_type, default_sql=None):
    """Add a column only when it isn't already present."""
    existing = {c["name"] for c in sa.inspect(conn).get_columns(table)}
    if column in existing:
        return
    ddl = f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"
    if default_sql is not None:
        ddl += f" DEFAULT {default_sql}"
    conn.execute(sa.text(ddl))


def _backfill_callsign(conn):
    from backend.core.callsign import extract_callsign

    rows = conn.execute(
        sa.text(
            "SELECT id, transcript FROM analysis_results "
            "WHERE callsign IS NULL AND transcript IS NOT NULL"
        )
    ).fetchall()
    for row_id, transcript in rows:
        callsign = extract_callsign(transcript or "")
        if callsign:
            conn.execute(
                sa.text("UPDATE analysis_results SET callsign = :callsign WHERE id = :id"),
                {"callsign": callsign, "id": row_id},
            )


# Ordered list. version_id strings are stable identifiers - never renumber or
# reuse them. New migrations append to the end.
MIGRATIONS: list[tuple[str, str, Callable]] = [
    (
        "0001_enrichment_column",
        "add analysis_results.enrichment",
        lambda c: _add_column_if_missing(c, "analysis_results", "enrichment", "TEXT"),
    ),
    (
        "0002_status_column",
        "add analysis_results.status (default 'new')",
        lambda c: _add_column_if_missing(c, "analysis_results", "status", "TEXT", "'new'"),
    ),
    (
        "0003_reviewer_notes_column",
        "add analysis_results.reviewer_notes",
        lambda c: _add_column_if_missing(c, "analysis_results", "reviewer_notes", "TEXT"),
    ),
    (
        "0004_adsb_snapshot_column",
        "add analysis_results.adsb_snapshot",
        lambda c: _add_column_if_missing(c, "analysis_results", "adsb_snapshot", "JSON"),
    ),
    (
        "0005_callsign_column",
        "add analysis_results.callsign",
        lambda c: _add_column_if_missing(c, "analysis_results", "callsign", "VARCHAR(16)"),
    ),
    (
        "0006_callsign_index",
        "index analysis_results.callsign",
        lambda c: c.execute(
            sa.text("CREATE INDEX IF NOT EXISTS ix_analysis_results_callsign ON analysis_results (callsign)")
        ),
    ),
    (
        "0007_callsign_backfill",
        "backfill analysis_results.callsign from transcript",
        _backfill_callsign,
    ),
]


def _ensure_table(conn) -> None:
    conn.execute(sa.text(_SCHEMA_MIGRATIONS_DDL))


def _applied_versions(conn) -> set[str]:
    rows = conn.execute(sa.text("SELECT version_id FROM schema_migrations")).fetchall()
    return {r[0] for r in rows}


def _record(conn, version_id: str) -> None:
    conn.execute(
        sa.text("INSERT INTO schema_migrations (version_id, applied_at) VALUES (:v, :t)"),
        {"v": version_id, "t": datetime.utcnow().isoformat()},
    )


async def run_migrations(engine) -> None:
    """Apply every migration whose version_id isn't already recorded."""
    async with engine.begin() as conn:
        await conn.run_sync(_ensure_table)
        applied = await conn.run_sync(_applied_versions)

    for version_id, _description, fn in MIGRATIONS:
        if version_id in applied:
            continue
        async with engine.begin() as conn:
            await conn.run_sync(fn)
            await conn.run_sync(lambda c, v=version_id: _record(c, v))
