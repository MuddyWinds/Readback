import pytest
from backend.core.callsign import normalize_callsign, is_plausible_callsign, phonetic_expand, extract_callsign


@pytest.mark.parametrize("raw,expected", [
    ("AAL 0123", "AAL123"),
    ("AAL0123", "AAL123"),   # zero-only strip (no space) — parity with callsign.test.ts
    ("DLH009", "DLH9"),      # multi-zero strip — parity with callsign.test.ts
    ("aal-123", "AAL123"),
    ("N123AB", "N123AB"),
    ("  ", None),
    (None, None),
])
def test_normalize_callsign(raw, expected):
    assert normalize_callsign(raw) == expected


@pytest.mark.parametrize("raw,ok", [
    ("AAL123", True),
    ("N12345", True),
    ("273", False),
    ("A1", False),
])
def test_is_plausible_callsign(raw, ok):
    assert is_plausible_callsign(raw) is ok


def test_extract_direct():
    assert extract_callsign("AAL123 contact ground") == "AAL123"


def test_extract_phonetic_airline_and_digits():
    assert extract_callsign("cathay two five zero descend") == "CPA250"


def test_extract_none_for_noise():
    assert extract_callsign("and uh roger that") is None
