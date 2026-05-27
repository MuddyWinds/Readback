"""Regression tests for results API row conversion."""

from datetime import datetime
import importlib
import sys


def _load_results_api(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    sys.modules.pop("backend.config", None)
    sys.modules.pop("backend.api.results", None)
    return importlib.import_module("backend.api.results")


class _Row:
    timestamp = datetime(2026, 5, 20, 1, 0)
    airport_code = "KJFK"
    transcript = "[audio not assessable]"
    assessable = False
    assessable_confidence = 0.25
    is_standard = True
    observations = []
    summary = "Audio quality too low for reliable transcription"
    confidence_score = 0.0


def test_stats_row_conversion_preserves_assessable_fields(monkeypatch):
    results_api = _load_results_api(monkeypatch)

    result = results_api._row_to_analysis_result(_Row())

    assert result.assessable is False
    assert result.assessable_confidence == 0.25
