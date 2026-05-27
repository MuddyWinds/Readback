"""get_client() rebuilds only when the live Gemini key changes."""

import importlib
import sys


def _load_phraseology(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "env-key")
    for mod in ("backend.config", "backend.analysis.phraseology"):
        sys.modules.pop(mod, None)
    return importlib.import_module("backend.analysis.phraseology")


def test_client_rebuilds_on_key_change_and_caches_otherwise(monkeypatch):
    phraseology = _load_phraseology(monkeypatch)

    builds = []

    class FakeClient:
        def __init__(self, api_key):
            self.api_key = api_key
            builds.append(api_key)

    monkeypatch.setattr(phraseology.genai, "Client", FakeClient)

    key = {"v": "key-1"}
    monkeypatch.setattr(phraseology, "current_gemini_key", lambda: key["v"])
    phraseology._client = None
    phraseology._client_key = None

    c1 = phraseology.get_client()
    c2 = phraseology.get_client()
    assert c1 is c2
    assert builds == ["key-1"]

    key["v"] = "key-2"
    c3 = phraseology.get_client()
    assert c3 is not c1
    assert builds == ["key-1", "key-2"]
    assert c3.api_key == "key-2"
