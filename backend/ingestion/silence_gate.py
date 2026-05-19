"""Framed RMS silence pre-gate.

A cheap energy check run *before* dispatching a chunk to Whisper, so silent
chunks (common on LiveATC tower feeds) never reach the transcriber.

Energy is measured per short frame, not over the whole chunk. A fixed 30s
chunk frequently holds one brief transmission inside a long silence; a
whole-chunk mean RMS would average that real speech below any useful
threshold. Framing keeps the chunk if *any* frame is loud enough.

This is a tuning-sensitive heuristic — too high a threshold drops real
transmissions. ``should_transcribe`` returns per-chunk RMS stats so callers
can log what was dropped and tune ``STT_RMS_THRESHOLD`` from real data.
"""

import numpy as np


def framed_rms(
    audio: np.ndarray,
    sample_rate: int = 16000,
    frame_seconds: float = 0.5,
) -> np.ndarray:
    """Return the RMS amplitude of each non-overlapping frame.

    A trailing partial frame (shorter than ``frame_seconds``) is included so
    energy at the tail of a chunk is never silently discarded.
    """
    if audio.size == 0:
        return np.array([], dtype=np.float64)

    frame = max(1, int(sample_rate * frame_seconds))
    return np.array(
        [
            float(np.sqrt(np.mean(audio[start : start + frame].astype(np.float64) ** 2)))
            for start in range(0, audio.size, frame)
        ],
        dtype=np.float64,
    )


def should_transcribe(
    audio: np.ndarray,
    threshold: float,
    sample_rate: int = 16000,
    frame_seconds: float = 0.5,
) -> tuple[bool, dict]:
    """Decide whether a chunk has enough energy to be worth transcribing.

    Returns ``(passed, stats)`` where ``passed`` is True if any frame's RMS
    reaches ``threshold``, and ``stats`` carries ``max_rms`` and ``p95_rms``
    for logging/tuning.
    """
    rms = framed_rms(audio, sample_rate, frame_seconds)
    if rms.size == 0:
        return False, {"max_rms": 0.0, "p95_rms": 0.0}

    max_rms = float(rms.max())
    stats = {"max_rms": max_rms, "p95_rms": float(np.percentile(rms, 95))}
    return max_rms >= threshold, stats
