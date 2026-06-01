"""Batch items must be ordered by (airport, timestamp) before the Gemini call."""

from datetime import datetime
import importlib
import sys


def _load_batcher(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    sys.modules.pop("backend.config", None)
    sys.modules.pop("backend.core.batcher", None)
    return importlib.import_module("backend.core.batcher")


def test_order_items_groups_by_airport_then_time(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    items = [
        {"airport_code": "KATL", "transcript": "a2", "timestamp": datetime(2026, 6, 1, 0, 2)},
        {"airport_code": "KJFK", "transcript": "j2", "timestamp": datetime(2026, 6, 1, 0, 5)},
        {"airport_code": "KATL", "transcript": "a1", "timestamp": datetime(2026, 6, 1, 0, 1)},
        {"airport_code": "KJFK", "transcript": "j1", "timestamp": datetime(2026, 6, 1, 0, 3)},
    ]
    ordered = batcher._order_items_for_batch(items)
    assert [it["transcript"] for it in ordered] == ["a1", "a2", "j1", "j2"]
    # Pure: input list is not mutated.
    assert items[0]["transcript"] == "a2"
