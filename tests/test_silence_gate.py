"""Tests for the framed RMS silence pre-gate.

The gate must measure energy per frame, not over the whole chunk: a fixed 30s
chunk often contains one short transmission surrounded by silence, and a
whole-chunk mean RMS would average that real speech away.
"""

import numpy as np
import pytest

from backend.ingestion.silence_gate import framed_rms, should_transcribe

SR = 16000


def test_framed_rms_splits_audio_into_frames():
    # 2s of audio at 0.5s frames -> 4 frames
    audio = np.zeros(SR * 2, dtype=np.float32)
    rms = framed_rms(audio, sample_rate=SR, frame_seconds=0.5)
    assert len(rms) == 4


def test_framed_rms_computes_energy_per_frame():
    # First 0.5s loud, the rest silent.
    audio = np.zeros(SR * 2, dtype=np.float32)
    audio[: SR // 2] = 0.4
    rms = framed_rms(audio, sample_rate=SR, frame_seconds=0.5)
    assert rms[0] == pytest.approx(0.4, abs=1e-3)
    assert rms[1] == pytest.approx(0.0, abs=1e-6)


def test_silent_chunk_is_gated_out():
    audio = np.zeros(SR * 30, dtype=np.float32)
    passed, stats = should_transcribe(audio, threshold=0.02, sample_rate=SR)
    assert passed is False
    assert stats["max_rms"] == pytest.approx(0.0, abs=1e-6)


def test_short_burst_in_long_silence_is_kept():
    # The regression case. A 3s burst inside an otherwise-silent 30s chunk:
    # whole-chunk mean RMS is ~0.095 and would miss a 0.15 threshold, but a
    # framed gate sees the 0.3 burst frame and keeps the chunk.
    audio = np.zeros(SR * 30, dtype=np.float32)
    audio[SR * 10 : SR * 13] = 0.3
    passed, stats = should_transcribe(audio, threshold=0.15, sample_rate=SR)
    assert passed is True
    assert stats["max_rms"] >= 0.15


def test_stats_report_max_and_percentile():
    audio = np.zeros(SR * 2, dtype=np.float32)
    audio[: SR // 2] = 0.5
    _, stats = should_transcribe(audio, threshold=1.0, sample_rate=SR)
    assert set(stats) >= {"max_rms", "p95_rms"}
    assert stats["max_rms"] == pytest.approx(0.5, abs=1e-3)


def test_empty_audio_is_gated_out_safely():
    passed, stats = should_transcribe(np.array([], dtype=np.float32), threshold=0.02)
    assert passed is False
    assert stats["max_rms"] == 0.0
