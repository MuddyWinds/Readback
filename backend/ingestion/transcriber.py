"""
Loads a faster-whisper model once and exposes a transcribe() function.
Uses the 'base' model by default — swap to 'small' or 'medium' for better accuracy.
"""

import tempfile
import numpy as np
import soundfile as sf
from faster_whisper import WhisperModel

from backend.config import settings

_model: WhisperModel | None = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        print(f"[Transcriber] Loading faster-whisper model: {settings.WHISPER_MODEL}")
        _model = WhisperModel(settings.WHISPER_MODEL, device="cpu", compute_type="int8")
    return _model


def transcribe(audio: np.ndarray) -> str:
    """
    Transcribe a float32 numpy audio array to text.
    Returns empty string if no speech detected.
    """
    model = get_model()

    # faster-whisper requires a file path or audio array — write to temp wav
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        sf.write(f.name, audio, 16000, format="WAV", subtype="FLOAT")
        segments, _ = model.transcribe(f.name, language="en", beam_size=5)
        text = " ".join(seg.text for seg in segments).strip()

    return text
