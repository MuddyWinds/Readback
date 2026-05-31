from __future__ import annotations

"""
Loads a faster-whisper model once and exposes a transcribe() function.
Returns transcript text alongside Whisper confidence metrics so the caller
can decide whether the result is assessable (Plan B quality gate).
"""

from concurrent.futures import ThreadPoolExecutor

import numpy as np
from faster_whisper import WhisperModel

from backend.config import settings
from backend.core.settings_store import current_runtime

_model: WhisperModel | None = None
_stt_executor: ThreadPoolExecutor | None = None

# Per-segment cutoff: a segment is "speech" if its no-speech probability is below
# this. Used to scope confidence to speech, not the silence around a short burst.
NO_SPEECH_PROB_THRESHOLD = 0.60

AVG_LOGPROB_THRESHOLD    = -0.85  # model very uncertain about its output (used by transcribe())

# Word-density hallucination heuristic. Whisper can invent fluent, high-logprob
# text from noise; such output crams many words into little speech duration.
# Real ATC rarely exceeds ~3 wps; 6.0 drops only egregious cases. NOT an
# independent control (timestamps are Whisper's own) — see spec §1a / Rollout.
WORDS_PER_SPEECH_SECOND_MAX = 6.0


def score_segments(segments) -> dict:
    """Speech-weighted scoring of Whisper segments.

    `segments` is any iterable of objects exposing text, avg_logprob,
    no_speech_prob, start, end. Confidence, text, and word_count are scoped to
    *speech-bearing* segments (no_speech_prob < NO_SPEECH_PROB_THRESHOLD) so a
    short clear transmission is not diluted by surrounding static — and so the
    text sent downstream is the same text the hallucination heuristic measures.
    """
    segments = list(segments)
    speech = [s for s in segments if s.no_speech_prob < NO_SPEECH_PROB_THRESHOLD]

    text = " ".join(s.text for s in speech).strip()
    word_count = len(text.split())

    if speech:
        avg_logprob_speech = sum(s.avg_logprob for s in speech) / len(speech)
        speech_seconds = sum((s.end - s.start) for s in speech)
    else:
        avg_logprob_speech = (
            sum(s.avg_logprob for s in segments) / len(segments) if segments else -2.0
        )
        speech_seconds = 0.0

    stt_confidence = max(0.0, min(1.0, 1.0 + avg_logprob_speech))

    return {
        "text": text,
        "stt_confidence": stt_confidence,
        "has_speech": bool(speech),
        "avg_logprob_speech": avg_logprob_speech,
        "speech_seconds": speech_seconds,
        "word_count": word_count,
    }


def is_likely_hallucination(word_count: int, speech_seconds: float) -> bool:
    """True when word density is implausibly high for the speech duration.

    The 0.5s floor avoids division by zero when no speech duration was measured.
    """
    return (word_count / max(speech_seconds, 0.5)) > WORDS_PER_SPEECH_SECOND_MAX


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        model_name = current_runtime().whisper_model or settings.WHISPER_MODEL
        print(f"[Transcriber] Loading faster-whisper model: {model_name}")
        _model = WhisperModel(
            model_name,
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
        concurrency = current_runtime().stt_concurrency or settings.STT_CONCURRENCY
        _stt_executor = ThreadPoolExecutor(
            max_workers=max(1, concurrency),
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
    segments_gen, _ = model.transcribe(
        audio, language="en", beam_size=5, vad_filter=settings.WHISPER_VAD_FILTER
    )
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
