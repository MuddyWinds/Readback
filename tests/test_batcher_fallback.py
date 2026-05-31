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


def test_batch_assessability_summary_separates_outage_from_verdict(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    from backend.models.schemas import AnalysisResult

    def _res(assessable):
        return AnalysisResult(
            timestamp=datetime(2026, 5, 20, 1, 0), airport_code="KJFK", transcript="x",
            assessable=assessable, assessable_confidence=0.5, is_standard=True,
            observations=[], summary="", confidence_score=0.5,
        )

    pairs = [
        ({"airport_code": "KJFK", "stt_confidence": 0.3}, _res(True)),   # low-conf, assessable
        ({"airport_code": "KATL", "stt_confidence": 0.9}, _res(False)),  # genuine Gemini "unassessable"
        ({"airport_code": "KSFO", "stt_confidence": 0.5, "analysis_failed": True}, _res(False)),  # outage fallback
    ]

    summary = batcher._batch_assessability_summary(pairs)
    assert summary == {
        "total": 3,
        "assessable": 1,
        "gemini_unassessable": 1,     # only the real verdict, NOT the outage card
        "analysis_unavailable": 1,    # the outage fallback, kept separate
        "low_conf_routed": 1,
    }
