"""run_monitor routing: what gets queued vs. silently skipped."""

import importlib
import sys

import numpy as np
import pytest


def _load_batcher(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    sys.modules.pop("backend.config", None)
    sys.modules.pop("backend.core.batcher", None)
    return importlib.import_module("backend.core.batcher")


class _Runtime:
    stt_rms_threshold = 0.0


def _patch(monkeypatch, batcher, transcribe_result):
    async def fake_stream(feed_url, chunk_seconds):
        yield np.zeros(16000, dtype=np.float32)  # one chunk, then the stream ends

    monkeypatch.setattr(batcher, "stream_audio_chunks", fake_stream)
    monkeypatch.setattr(batcher, "should_transcribe", lambda audio, thr: (True, {"max_rms": 0.5, "p95_rms": 0.4}))
    monkeypatch.setattr(batcher, "current_runtime", lambda: _Runtime())
    monkeypatch.setattr(batcher, "transcribe", lambda audio: transcribe_result)


async def _drain(queue):
    items = []
    while not queue.empty():
        items.append(queue.get_nowait())
    return items


@pytest.mark.anyio
async def test_run_monitor_queues_readable_low_confidence_text(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    await _drain(batcher.transcript_queue)
    _patch(monkeypatch, batcher, {
        "text": "Delta 456 contact ground point niner now", "stt_confidence": 0.3,
        "speech_seconds": 3.0, "word_count": 7, "assessable": True, "reason": None,
    })
    await batcher.run_monitor("http://feed", "KJFK")
    items = await _drain(batcher.transcript_queue)
    assert len(items) == 1
    assert items[0]["stt_assessable"] is True
    assert items[0]["stt_confidence"] == 0.3
    assert items[0]["words_per_speech_second"] == pytest.approx(7 / 3.0)  # carried for Task 5
    assert "assessable_confidence" not in items[0]  # canonical key only


@pytest.mark.anyio
async def test_run_monitor_skips_no_speech_without_card(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    await _drain(batcher.transcript_queue)
    _patch(monkeypatch, batcher, {
        "text": "", "stt_confidence": 0.0, "speech_seconds": 0.0, "word_count": 0,
        "assessable": False, "reason": "No recoverable speech",
    })
    await batcher.run_monitor("http://feed", "KJFK")
    assert await _drain(batcher.transcript_queue) == []


@pytest.mark.anyio
async def test_run_monitor_skips_short_transcript(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    await _drain(batcher.transcript_queue)
    _patch(monkeypatch, batcher, {
        "text": "go around", "stt_confidence": 0.8, "speech_seconds": 1.0, "word_count": 2,
        "assessable": True, "reason": None,
    })
    await batcher.run_monitor("http://feed", "KJFK")
    assert await _drain(batcher.transcript_queue) == []


@pytest.mark.anyio
async def test_run_monitor_hallucination_skips_and_counts(monkeypatch):
    batcher = _load_batcher(monkeypatch)
    await _drain(batcher.transcript_queue)
    before = batcher.pipeline_status.get("hallucination_skips", 0)
    _patch(monkeypatch, batcher, {
        "text": "one two three four five six seven eight", "stt_confidence": 0.7,
        "speech_seconds": 0.5, "word_count": 8, "assessable": False,
        "reason": "Likely transcription hallucination — word density too high for speech duration",
    })
    await batcher.run_monitor("http://feed", "KJFK")
    assert await _drain(batcher.transcript_queue) == []
    assert batcher.pipeline_status.get("hallucination_skips", 0) == before + 1
