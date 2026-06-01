"""Settings cache: env fallback, best-effort resolution, and live accessors."""

import importlib
import sys

import pytest


def _load_store(monkeypatch, gemini="env-key", rms="0.0", model="base", conc="1"):
    monkeypatch.setenv("GEMINI_API_KEY", gemini)
    monkeypatch.setenv("STT_RMS_THRESHOLD", rms)
    monkeypatch.setenv("WHISPER_MODEL", model)
    monkeypatch.setenv("STT_CONCURRENCY", conc)
    sys.modules.pop("backend.config", None)
    sys.modules.pop("backend.core.settings_store", None)
    return importlib.import_module("backend.core.settings_store")


def test_env_default_seeds_runtime_from_env(monkeypatch):
    store = _load_store(monkeypatch, gemini="env-key", rms="0.02", model="small", conc="2")
    s = store._env_default()
    assert s.gemini_api_key == "env-key"
    assert s.feeds == []
    assert s.runtime.stt_rms_threshold == pytest.approx(0.02)
    assert s.runtime.whisper_model == "small"
    assert s.runtime.stt_concurrency == 2


def test_resolve_fills_geo_for_known_codes_and_degrades_for_unknown(monkeypatch):
    store = _load_store(monkeypatch)
    from backend.models.settings_schemas import AppSettings, FeedConfig
    s = AppSettings(feeds=[
        FeedConfig(url="http://audio.liveatc.net/kjfk9_s", airport_code="KJFK"),
        FeedConfig(url="http://audio.liveatc.net/zzzz", airport_code="ZZZZ"),
    ])
    resolved = store._resolve(s)
    assert resolved.feeds[0].lat == pytest.approx(40.64, abs=0.01)
    assert resolved.feeds[0].runways
    assert resolved.feeds[1].lat is None
    assert resolved.feeds[1].runways == []


def test_current_gemini_key_prefers_cache_then_env(monkeypatch):
    store = _load_store(monkeypatch, gemini="env-key")
    from backend.models.settings_schemas import AppSettings
    monkeypatch.setattr(store, "_cache", None)
    assert store.current_gemini_key() == "env-key"
    monkeypatch.setattr(store, "_cache", AppSettings(gemini_api_key="saved-key"))
    assert store.current_gemini_key() == "saved-key"


def test_current_runtime_falls_back_to_env_when_no_cache(monkeypatch):
    store = _load_store(monkeypatch, rms="0.05")
    monkeypatch.setattr(store, "_cache", None)
    assert store.current_runtime().stt_rms_threshold == pytest.approx(0.05)


def test_current_gemini_model_defaults_then_reads_cache(monkeypatch):
    store = _load_store(monkeypatch)
    from backend.models.settings_schemas import AppSettings, RuntimeConfig
    monkeypatch.setattr(store, "_cache", None)
    assert store.current_gemini_model() == "gemini-2.5-flash"
    monkeypatch.setattr(
        store, "_cache",
        AppSettings(runtime=RuntimeConfig(gemini_model="gemini-3.5-flash")),
    )
    assert store.current_gemini_model() == "gemini-3.5-flash"


def test_current_gemini_model_falls_back_on_blank(monkeypatch):
    store = _load_store(monkeypatch)
    from backend.models.settings_schemas import AppSettings, RuntimeConfig
    monkeypatch.setattr(
        store, "_cache",
        AppSettings(runtime=RuntimeConfig(gemini_model="")),
    )
    assert store.current_gemini_model() == "gemini-2.5-flash"
