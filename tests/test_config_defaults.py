"""Configuration defaults that affect runtime resource use."""

import importlib
import sys

import pytest


def _load_config(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    sys.modules.pop("backend.config", None)
    return importlib.import_module("backend.config")


def test_silence_gate_is_disabled_by_default_until_feed_calibrated(monkeypatch):
    config = _load_config(monkeypatch)

    assert config.settings.STT_RMS_THRESHOLD == pytest.approx(0.0)
