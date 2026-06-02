import pytest
from backend.core.callsign import normalize_callsign, is_plausible_callsign


@pytest.mark.parametrize("raw,expected", [
    ("AAL 0123", "AAL123"),
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
