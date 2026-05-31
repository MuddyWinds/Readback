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


class _RecordingModels:
    def __init__(self):
        self.last_contents = None

    def generate_content(self, **kwargs):
        self.last_contents = kwargs.get("contents")
        return _FakeResponse()


class _RecordingClient:
    def __init__(self):
        self.models = _RecordingModels()


@pytest.mark.anyio
async def test_persisted_confidence_is_stt_not_gemini(monkeypatch):
    phraseology = _load_phraseology(monkeypatch)
    client = _RecordingClient()
    monkeypatch.setattr(phraseology, "get_client", lambda: client)

    # _FakeResponse only answers index 1, so use two items; assert on index 1.
    items = [
        {"airport_code": "KJFK", "transcript": "first", "timestamp": datetime(2026, 5, 20, 1, 0), "stt_confidence": 0.33},
        {"airport_code": "KATL", "transcript": "second", "timestamp": datetime(2026, 5, 20, 1, 1), "stt_confidence": 0.55},
    ]

    results = await phraseology.analyze_batch(items)

    # Gemini returned assessable_confidence 0.9 for index 1; we persist the STT value.
    assert results[1].assessable_confidence == 0.55
    # Header carries the stt_conf annotation.
    assert "stt_conf=0.55" in client.models.last_contents


@pytest.mark.anyio
async def test_missing_result_preserves_stt_confidence(monkeypatch):
    phraseology = _load_phraseology(monkeypatch)
    item = {"airport_code": "KJFK", "transcript": "x", "timestamp": datetime(2026, 5, 20, 1, 0), "stt_confidence": 0.42}
    result = phraseology._missing_analysis_result(item, "missing")
    assert result.assessable_confidence == 0.42


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
