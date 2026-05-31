"""Regression tests for preserving transcript cards when Gemini fails."""

from datetime import datetime
import importlib
import sys


def _load_batcher(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    sys.modules.pop("backend.config", None)
    sys.modules.pop("backend.core.batcher", None)
    return importlib.import_module("backend.core.batcher")


def test_gemini_fallback_preserves_each_transcript_as_visible_result(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    items = [
        {"airport_code": "KJFK", "transcript": "cleared to land runway two two left", "timestamp": datetime(2026, 5, 20, 1, 0)},
        {"airport_code": "KATL", "transcript": "taxi via bravo hold short runway two seven", "timestamp": datetime(2026, 5, 20, 1, 1)},
    ]

    pairs = batcher._gemini_failure_pairs(items, RuntimeError("503 UNAVAILABLE"))

    assert len(pairs) == 2
    assert [item["transcript"] for item, _ in pairs] == [item["transcript"] for item in items]
    for item, result in pairs:
        assert result.airport_code == item["airport_code"]
        assert result.transcript == item["transcript"]
        assert result.assessable is False
        assert result.is_standard is True
        assert result.observations == []
        assert result.confidence_score == 0.0
        assert "Analysis temporarily unavailable" in result.summary


def test_gemini_fallback_preserves_stt_confidence(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    items = [
        {"airport_code": "KJFK", "transcript": "cleared to land", "timestamp": datetime(2026, 5, 20, 1, 0), "stt_confidence": 0.62},
        {"airport_code": "KATL", "transcript": "hold short", "timestamp": datetime(2026, 5, 20, 1, 1)},  # missing key
    ]

    pairs = batcher._gemini_failure_pairs(items, RuntimeError("503 UNAVAILABLE"))

    # Real STT confidence is preserved; a Gemini failure is not a transcription failure.
    assert pairs[0][1].assessable_confidence == 0.62
    # Missing key falls back to 0.0.
    assert pairs[1][1].assessable_confidence == 0.0
