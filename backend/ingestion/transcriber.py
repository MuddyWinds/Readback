"""
Loads a faster-whisper model once and exposes a transcribe() function.
Returns transcript text alongside Whisper confidence metrics so the caller
can decide whether the result is assessable (Plan B quality gate).
"""

from concurrent.futures import ThreadPoolExecutor

import numpy as np
from faster_whisper import WhisperModel

from backend.config import settings

_model: WhisperModel | None = None
_stt_executor: ThreadPoolExecutor | None = None

# Plan B thresholds — if either is exceeded, mark transcript unassessable
NO_SPEECH_PROB_THRESHOLD = 0.60   # >60% chance segment is not speech
AVG_LOGPROB_THRESHOLD    = -0.85  # model very uncertain about its output


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        print(f"[Transcriber] Loading faster-whisper model: {settings.WHISPER_MODEL}")
        _model = WhisperModel(
            settings.WHISPER_MODEL,
            device="cpu",
            compute_type="int8",
            cpu_threads=settings.WHISPER_CPU_THREADS,
        )
    return _model


def get_stt_executor() -> ThreadPoolExecutor:
    """Dedicated thread pool for transcription.

    Bounding ``max_workers`` to ``STT_CONCURRENCY`` caps how many Whisper jobs
    run at once across all feeds — without this, several feeds can each push a
    chunk into the default executor and overcommit the CPU. Excess chunks queue
    here rather than running in parallel.
    """
    global _stt_executor
    if _stt_executor is None:
        _stt_executor = ThreadPoolExecutor(
            max_workers=max(1, settings.STT_CONCURRENCY),
            thread_name_prefix="stt",
        )
    return _stt_executor


def transcribe(audio: np.ndarray) -> dict:
    """
    Transcribe a float32 numpy audio array.
    Returns:
      {
        "text": str,
        "avg_logprob": float,       # average log-prob across segments (higher = better)
        "no_speech_prob": float,    # average no-speech probability (lower = better)
        "assessable": bool,         # False if confidence below threshold
        "reason": str | None        # why unassessable, if applicable
      }
    """
    model = get_model()

    # faster-whisper accepts a float32 numpy array directly — no temp WAV needed.
    segments_gen, _ = model.transcribe(audio, language="en", beam_size=5)
    segments = list(segments_gen)

    if not segments:
        return {
            "text": "", "avg_logprob": -2.0, "no_speech_prob": 1.0,
            "assessable": False, "reason": "No speech segments detected",
        }

    text = " ".join(seg.text for seg in segments).strip()
    avg_logprob   = sum(s.avg_logprob   for s in segments) / len(segments)
    no_speech_prob = sum(s.no_speech_prob for s in segments) / len(segments)

    # Plan B quality gate
    if no_speech_prob > NO_SPEECH_PROB_THRESHOLD:
        return {
            "text": text, "avg_logprob": avg_logprob,
            "no_speech_prob": no_speech_prob, "assessable": False,
            "reason": f"High no-speech probability ({no_speech_prob:.2f}) — likely noise or silence",
        }
    if avg_logprob < AVG_LOGPROB_THRESHOLD:
        return {
            "text": text, "avg_logprob": avg_logprob,
            "no_speech_prob": no_speech_prob, "assessable": False,
            "reason": f"Low transcription confidence (logprob {avg_logprob:.2f}) — audio may be too degraded",
        }

    return {
        "text": text, "avg_logprob": avg_logprob,
        "no_speech_prob": no_speech_prob, "assessable": True, "reason": None,
    }
