from __future__ import annotations

"""Transmission segmentation + transcript distillation.

A fixed audio window (see ``audio_stream``) is a blunt container: it bundles
several unrelated radio transmissions and the dead air between them into one
transcript. That is why a single card can mix two aircraft (e.g. MAS377 and
CCA373) and why a whole-window quality gate rejects a clear transmission just
because the rest of the window was silence/noise.

These helpers do the "more processing to distil the text" step:

  * ``group_transmissions`` splits a window's Whisper segments into individual
    transmissions on real silence gaps. An instruction and its immediate
    read-back (sub-second gap) stay in one transmission so read-back analysis
    still has both sides; an unrelated aircraft seconds later becomes its own.

  * ``distill_text`` collapses the consecutive-duplicate phrase loops that
    faster-whisper emits on degraded audio ("X. X. X. X." → "X.").

Both are pure functions so they can be unit-tested without audio or a model.
"""

import re


def group_transmissions(segments: list[dict], max_gap_seconds: float) -> list[dict]:
    """Group Whisper segments into transmissions, splitting on silence gaps.

    Each input segment is a dict with ``text``/``start``/``end`` and the quality
    metrics ``avg_logprob``/``no_speech_prob``. Consecutive segments whose
    inter-segment gap is ``<= max_gap_seconds`` belong to the same transmission;
    a larger gap starts a new one.

    Returns one dict per transmission carrying the joined ``text``, the span
    ``start``/``end``, and the per-transmission mean of each quality metric (so
    a clean transmission is assessed on its own merits, not dragged down by a
    noisy neighbour in the same window).
    """
    ordered = sorted(segments, key=lambda s: s["start"])
    groups: list[list[dict]] = []
    for s in ordered:
        if groups and s["start"] - groups[-1][-1]["end"] <= max_gap_seconds:
            groups[-1].append(s)
        else:
            groups.append([s])

    out: list[dict] = []
    for g in groups:
        n = len(g)
        out.append({
            "text": " ".join(seg["text"].strip() for seg in g).strip(),
            "start": g[0]["start"],
            "end": g[-1]["end"],
            "avg_logprob": sum(seg["avg_logprob"] for seg in g) / n,
            "no_speech_prob": sum(seg["no_speech_prob"] for seg in g) / n,
        })
    return out


# Sentence-ish unit: a run of text ending at . ! ? (keeping the delimiter).
_SENTENCE_RE = re.compile(r"[^.!?]*[.!?]|[^.!?]+$")


def _norm(s: str) -> str:
    """Normalise for duplicate comparison: lowercase, collapse whitespace,
    drop trailing punctuation."""
    return re.sub(r"\s+", " ", s).strip().rstrip(".!?").lower()


def distill_text(text: str) -> str:
    """Collapse consecutive duplicate sentences and normalise whitespace.

    Targets faster-whisper's repeated-phrase loops on poor audio. Distinct
    sentences are preserved verbatim (aside from whitespace normalisation).
    """
    collapsed = re.sub(r"\s+", " ", text).strip()
    if not collapsed:
        return ""

    pieces = [m.group(0).strip() for m in _SENTENCE_RE.finditer(collapsed)]
    pieces = [p for p in pieces if p]

    kept: list[str] = []
    prev_norm: str | None = None
    for p in pieces:
        n = _norm(p)
        if n and n == prev_norm:
            continue  # immediate repeat — drop
        kept.append(p)
        prev_norm = n

    return " ".join(kept)
