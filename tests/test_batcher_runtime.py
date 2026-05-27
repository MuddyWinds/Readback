"""Batcher reads geo + batch interval from settings, not module constants."""

import importlib
import sys


def _load_batcher(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.core.settings_store", "backend.core.batcher"):
        sys.modules.pop(mod, None)
    return importlib.import_module("backend.core.batcher")


def test_batcher_has_no_hardcoded_airport_geo(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    assert not hasattr(batcher, "AIRPORT_GEO")


def test_snapshot_reports_live_batch_interval(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    from backend.models.settings_schemas import AppSettings, RuntimeConfig
    import backend.core.settings_store as store
    monkeypatch.setattr(store, "_cache", AppSettings(runtime=RuntimeConfig(batch_interval_seconds=42)))
    snap = batcher.get_pipeline_snapshot()
    assert snap["batch_interval_seconds"] == 42
