"""init_db wires create_all then the versioned migration runner (in that order)."""

import importlib
import sys

import pytest


def _load_database(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    sys.modules.pop("backend.config", None)
    sys.modules.pop("backend.db.database", None)
    return importlib.import_module("backend.db.database")


class _FakeConnection:
    def __init__(self, log):
        self._log = log

    async def run_sync(self, _fn):
        self._log.append("create_all")


class _FakeTransaction:
    def __init__(self, log):
        self._log = log

    async def __aenter__(self):
        return _FakeConnection(self._log)

    async def __aexit__(self, *_exc):
        return False


class _FakeEngine:
    def __init__(self, log):
        self._log = log

    def begin(self):
        return _FakeTransaction(self._log)


@pytest.mark.anyio
async def test_init_db_creates_schema_then_runs_migrations(monkeypatch):
    database = _load_database(monkeypatch)
    log = []
    monkeypatch.setattr(database, "engine", _FakeEngine(log))

    async def _fake_run_migrations(_engine):
        log.append("run_migrations")

    monkeypatch.setattr(database, "run_migrations", _fake_run_migrations)

    await database.init_db()

    assert log == ["create_all", "run_migrations"]
