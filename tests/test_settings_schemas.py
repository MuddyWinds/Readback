"""Settings schemas: defaults, feed objects, and runtime split."""

import pytest
from pydantic import ValidationError

from backend.models.settings_schemas import AppSettings, FeedConfig, RuntimeConfig


def test_appsettings_defaults_are_empty_and_env_shaped():
    s = AppSettings()
    assert s.gemini_api_key == ""
    assert s.feeds == []
    assert s.runtime.batch_interval_seconds == 300
    assert s.runtime.stt_rms_threshold == 0.0
    assert s.runtime.whisper_model == "base"
    assert s.runtime.stt_concurrency == 1


def test_feedconfig_carries_user_and_resolved_fields():
    f = FeedConfig(url="http://audio.liveatc.net/kjfk9_s", airport_code="KJFK")
    assert f.label == ""
    assert f.lat is None and f.lon is None and f.name is None
    assert f.runways == []


def test_appsettings_roundtrips_through_dict():
    s = AppSettings(
        gemini_api_key="abc",
        feeds=[FeedConfig(url="http://audio.liveatc.net/katl_twr", airport_code="KATL", label="Atlanta")],
        runtime=RuntimeConfig(batch_interval_seconds=120),
    )
    restored = AppSettings(**s.model_dump())
    assert restored.gemini_api_key == "abc"
    assert restored.feeds[0].airport_code == "KATL"
    assert restored.runtime.batch_interval_seconds == 120


def test_runtimeconfig_alert_min_severity_defaults_to_high():
    assert RuntimeConfig().alert_min_severity == "high"


def test_runtimeconfig_parses_legacy_blob_without_alert_field():
    legacy = {
        "batch_interval_seconds": 120,
        "stt_rms_threshold": 0.0,
        "whisper_model": "base",
        "stt_concurrency": 1,
    }
    cfg = RuntimeConfig(**legacy)
    assert cfg.alert_min_severity == "high"
    assert cfg.batch_interval_seconds == 120


def test_runtimeconfig_rejects_invalid_alert_severity():
    with pytest.raises(ValidationError):
        RuntimeConfig(alert_min_severity="urgent")
