"""Both Gemini call sites send the model chosen in settings."""

import asyncio
import datetime as dt

import backend.analysis.phraseology as phraseology


class _RecordingModels:
    def __init__(self, recorder, text):
        self._rec = recorder
        self._text = text

    def generate_content(self, **kwargs):
        self._rec.append(kwargs.get("model"))

        class _Resp:
            text = self._text

        return _Resp()


class _RecordingClient:
    def __init__(self, recorder, text):
        self.models = _RecordingModels(recorder, text)


def test_analyze_batch_uses_selected_model(monkeypatch):
    recorder: list[str] = []
    # "[]" parses to an empty result set -> each item becomes a missing/unassessable
    # result with no exception; the model is recorded before parsing.
    monkeypatch.setattr(phraseology, "get_client", lambda: _RecordingClient(recorder, "[]"))
    monkeypatch.setattr(phraseology, "current_gemini_model", lambda: "gemini-3.5-flash")
    items = [{
        "airport_code": "KJFK",
        "transcript": "United 123 cleared to land",
        "timestamp": dt.datetime(2026, 6, 1, 12, 0, 0),
    }]
    asyncio.run(phraseology.analyze_batch(items))
    assert recorder == ["gemini-3.5-flash"]


def test_generate_study_sheet_uses_selected_model(monkeypatch):
    recorder: list[str] = []
    monkeypatch.setattr(phraseology, "get_client", lambda: _RecordingClient(recorder, "study sheet"))
    monkeypatch.setattr(phraseology, "current_gemini_model", lambda: "gemini-3.1-flash-lite")
    threads = [{
        "timestamp": "2026-06-01T12:00:00",
        "airport_code": "KJFK",
        "transcript": "United 123 cleared to land",
        "is_standard": True,
        "summary": "ok",
    }]
    out = asyncio.run(phraseology.generate_study_sheet("UAL123", threads))
    assert recorder == ["gemini-3.1-flash-lite"]
    assert out == "study sheet"
