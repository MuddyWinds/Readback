"""Regression tests for database initialization transaction handling."""

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
    def __init__(self, transaction):
        self.transaction = transaction

    async def run_sync(self, _fn):
        self.transaction.created_schema = True

    async def execute(self, _statement):
        self.transaction.aborted = True
        raise RuntimeError("duplicate column")


class _FakeTransaction:
    def __init__(self, engine):
        self.engine = engine
        self.created_schema = False
        self.aborted = False

    async def __aenter__(self):
        return _FakeConnection(self)

    async def __aexit__(self, exc_type, _exc, _tb):
        if exc_type is None and not self.aborted and self.created_schema:
            self.engine.schema_created = True
        return False


class _FakeEngine:
    schema_created = False

    def begin(self):
        return _FakeTransaction(self)


@pytest.mark.anyio
async def test_init_db_keeps_schema_when_compatibility_migrations_fail(monkeypatch):
    database = _load_database(monkeypatch)
    fake_engine = _FakeEngine()
    monkeypatch.setattr(database, "engine", fake_engine)

    await database.init_db()

    assert fake_engine.schema_created is True
