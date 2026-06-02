"""
Callsign normalization and phonetic extraction.

Ports frontend/src/lib/callsign.ts (normalizeCallsign) and
frontend/src/lib/transcript.ts (phoneticExpand / extractCallsign).

Python-specific notes:
- is_plausible_callsign is a new backend helper (not in the TS sources).
- The N-number pattern uses the Q5-standard N\\d{1,5}[A-Z]{0,2} rather than
  the frontend CALLSIGN_REGEX's N\\d{4,5}[A-Z]{0,2}.
- extract_callsign returns a normalized key (str | None) rather than the TS
  {callsign, confidence} object.
"""
from __future__ import annotations

import re
from typing import Optional

# ---------------------------------------------------------------------------
# Normalization (ported from callsign.ts)
# ---------------------------------------------------------------------------

_WS_DASH = re.compile(r"[\s-]+")
_ICAO = re.compile(r"^([A-Z]{2,3})0*(\d+)([A-Z]?)$")

# Plausibility regexes (new backend helpers derived from shared CALLSIGN_REGEX).
# Q5 standard: N + 1-5 digits + up to two trailing letters.
_PLAUSIBLE_ICAO = re.compile(r"^[A-Z]{2,3}\d{1,4}[A-Z]?$")
_PLAUSIBLE_NNUM = re.compile(r"^N\d{1,5}[A-Z]{0,2}$")


def normalize_callsign(cs: Optional[str]) -> Optional[str]:
    """Normalize a raw callsign string to a canonical key.

    Rules (matches frontend normalizeCallsign exactly):
    - Strip internal whitespace and dashes, uppercase.
    - N-numbers pass through unchanged.
    - ICAO airline callsigns: strip leading zeros from the numeric block.
    """
    if not isinstance(cs, str):
        return None
    trimmed = _WS_DASH.sub("", cs).upper()
    if not trimmed:
        return None
    if re.match(r"^N\d", trimmed):       # N-numbers: pass through
        return trimmed
    m = _ICAO.match(trimmed)             # strip leading zeros in numeric block
    if m:
        return f"{m.group(1)}{m.group(2)}{m.group(3)}"
    return trimmed


def is_plausible_callsign(cs: Optional[str]) -> bool:
    """Return True if *cs* looks like a real callsign after normalization."""
    norm = normalize_callsign(cs)
    if not norm:
        return False
    return bool(_PLAUSIBLE_ICAO.match(norm) or _PLAUSIBLE_NNUM.match(norm))


# ---------------------------------------------------------------------------
# Phonetic expansion + extraction (ported from transcript.ts)
# ---------------------------------------------------------------------------

PHONETIC_DIGIT: dict[str, str] = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4",
    "five": "5", "six": "6", "seven": "7", "eight": "8", "nine": "9", "niner": "9",
}

AIRLINE_ICAO: dict[str, str] = {
    "delta": "DAL", "american": "AAL", "united": "UAL", "southwest": "SWA",
    "jetblue": "JBU", "alaska": "ASA", "spirit": "NKS", "frontier": "FFT",
    "allegiant": "AAY", "lufthansa": "DLH", "british": "BAW", "cathay": "CPA",
    "emirates": "UAE", "singapore": "SIA", "qantas": "QFA", "air": "ACA",
    "continental": "COA", "expressjet": "SKW", "envoy": "ENY", "skywest": "SKW",
}

# Q5-standard callsign regex used for direct and post-expansion matching.
_CALLSIGN_RE = re.compile(r"\b([A-Z]{2,3}\d{1,4}[A-Z]?|N\d{1,5}[A-Z]{0,2})\b")


def phonetic_expand(text: str) -> str:
    """Expand phonetic ATC speech to standard callsign format.

    Mirrors frontend phoneticExpand:
    1. Airline names → ICAO prefixes.
    2. Number words → digits.
    3. Collapse spaces between prefix letters and digit run.
    Result is uppercased.
    """
    out = text.lower()
    for name, icao in AIRLINE_ICAO.items():
        out = re.sub(rf"\b{name}\b", icao, out)
    for word, digit in PHONETIC_DIGIT.items():
        out = re.sub(rf"\b{word}\b", digit, out)
    out = re.sub(
        r"([A-Za-z]{2,3})\s+(\d[\d\s]*\d|\d)",
        lambda m: m.group(1).upper() + re.sub(r"\s", "", m.group(2)),
        out,
    )
    return out.upper()


def extract_callsign(text: str) -> Optional[str]:
    """Return the first plausible callsign found in *text*, normalized.

    Tries a direct regex match first (high confidence), then falls back to
    phonetic expansion (low confidence).  Returns None if nothing plausible
    is found.
    """
    if not text:
        return None
    direct = _CALLSIGN_RE.search(text.upper())
    if direct and is_plausible_callsign(direct.group(1)):
        return normalize_callsign(direct.group(1))
    expanded = _CALLSIGN_RE.search(phonetic_expand(text))
    if expanded and is_plausible_callsign(expanded.group(1)):
        return normalize_callsign(expanded.group(1))
    return None
