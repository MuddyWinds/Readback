"""Regression tests for Gemini batch result alignment."""

from datetime import datetime
import importlib
import sys

import pytest


class _FakeResponse:
    text = """[
      {
        "index": 1,
        "assessable": true,
        "assessable_confidence": 0.9,
        "is_standard": false,
        "confidence_score": 0.8,
        "summary": "Second transcript analysis",
        "observations": [],
        "speaker_segments": [],
        "atc_instruction": null,
        "pilot_readback": null,
        "readback_correct": null,
        "readback_discrepancy": null,
        "callsign_detected": "DAL456",
        "callsign_clarity": 95
      }
    ]"""


class _FakeModels:
    def generate_content(self, **_kwargs):
        return _FakeResponse()


class _FakeClient:
    models = _FakeModels()


def _load_phraseology(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    sys.modules.pop("backend.config", None)
    sys.modules.pop("backend.analysis.phraseology", None)
    return importlib.import_module("backend.analysis.phraseology")


@pytest.mark.anyio
async def test_batch_analysis_keeps_results_aligned_when_model_omits_an_index(monkeypatch):
    phraseology = _load_phraseology(monkeypatch)
    monkeypatch.setattr(phraseology, "get_client", lambda: _FakeClient())

    items = [
        {"airport_code": "KJFK", "transcript": "first transcript", "timestamp": datetime(2026, 5, 20, 1, 0)},
        {"airport_code": "KATL", "transcript": "second transcript", "timestamp": datetime(2026, 5, 20, 1, 1)},
    ]

    results = await phraseology.analyze_batch(items)

    assert len(results) == 2
    assert results[0].airport_code == "KJFK"
    assert results[0].transcript == "first transcript"
    assert results[0].assessable is False
    assert "missing" in results[0].summary.lower()
    assert results[1].airport_code == "KATL"
    assert results[1].transcript == "second transcript"
    assert results[1].summary == "Second transcript analysis"
