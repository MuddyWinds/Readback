"""Per-callsign attribution survives Gemini parsing (and old shapes still work)."""

from datetime import datetime
import importlib
import sys

import pytest


class _FakeResponse:
    text = """[
      {
        "index": 0,
        "assessable": true,
        "assessable_confidence": 0.9,
        "is_standard": false,
        "confidence_score": 0.8,
        "summary": "Two aircraft on tower",
        "observations": [
          {"kind": "phraseology_note", "note_type": "Read-back Error",
           "hfacs_level": "Unsafe Act", "significance": "medium",
           "description": "readback gap", "safety_pathway": "x -> y -> z",
           "relevant_regulation": "ICAO Doc 4444", "transcript_excerpt": "left 280",
           "callsign": "UAL12"},
          {"kind": "situational_event", "note_type": "Go-around Non-compliance",
           "hfacs_level": "Unsafe Act", "significance": "high",
           "description": "go around", "callsign": "DAL456"}
        ],
        "speaker_segments": [
          {"role": "ATC", "text": "United 12 turn left heading 270", "callsign": "UAL12"},
          {"role": "PILOT", "text": "left 280 United 12", "callsign": "UAL12"},
          {"role": "ATC", "text": "Delta 456 go around", "callsign": "DAL456"}
        ],
        "atc_instruction": null, "pilot_readback": null, "readback_correct": null,
        "readback_discrepancy": null, "callsign_detected": "UAL12", "callsign_clarity": 90
      },
      {
        "index": 1,
        "assessable": true,
        "assessable_confidence": 0.9,
        "is_standard": false,
        "confidence_score": 0.7,
        "summary": "Old shape, no per-item callsign",
        "observations": [
          {"kind": "phraseology_note", "note_type": "Other",
           "hfacs_level": "Unsafe Act", "significance": "low",
           "description": "legacy"}
        ],
        "speaker_segments": [{"role": "ATC", "text": "no callsign field here"}],
        "atc_instruction": null, "pilot_readback": null, "readback_correct": null,
        "readback_discrepancy": null, "callsign_detected": "AAL1", "callsign_clarity": 80
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
async def test_observation_and_segment_callsigns_round_trip(monkeypatch):
    phraseology = _load_phraseology(monkeypatch)
    monkeypatch.setattr(phraseology, "get_client", lambda: _FakeClient())

    items = [
        {"airport_code": "KJFK", "transcript": "two aircraft", "timestamp": datetime(2026, 5, 20, 1, 0)},
        {"airport_code": "KATL", "transcript": "legacy",       "timestamp": datetime(2026, 5, 20, 1, 1)},
    ]

    results = await phraseology.analyze_batch(items)

    # Per-observation callsign
    assert results[0].observations[0].callsign == "UAL12"
    assert results[0].observations[1].callsign == "DAL456"
    # Per-segment callsign
    segs = results[0].enrichment["speaker_segments"]
    assert segs[0]["callsign"] == "UAL12"
    assert segs[2]["callsign"] == "DAL456"
    assert segs[0]["role"] == "ATC" and segs[0]["text"].startswith("United 12")

    # Backward compatibility: missing callsign -> None, nothing dropped
    assert results[1].observations[0].callsign is None
    assert results[1].enrichment["speaker_segments"][0]["callsign"] is None
    assert results[1].enrichment["speaker_segments"][0]["text"] == "no callsign field here"
