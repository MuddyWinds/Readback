import sys


def _load(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for m in ("backend.config", "backend.core.callsign", "backend.api.reports"):
        sys.modules.pop(m, None)


def test_core_extractor_handles_phonetics(monkeypatch):
    _load(monkeypatch)
    from backend.core.callsign import extract_callsign
    assert extract_callsign("CATHAY TWO FIVE ZERO") == "CPA250"


def test_reports_uses_shared_extractor(monkeypatch):
    _load(monkeypatch)
    import backend.api.reports as reports
    from backend.core import callsign
    # reports.py must `from backend.core.callsign import extract_callsign`
    assert reports.extract_callsign is callsign.extract_callsign
