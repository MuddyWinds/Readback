"""Settings endpoints with the store and httpx stubbed."""

import importlib
import sys

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def _client(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "env-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.core.settings_store", "backend.api.settings"):
        sys.modules.pop(mod, None)
    settings_api = importlib.import_module("backend.api.settings")
    app = FastAPI()
    app.include_router(settings_api.router)
    return settings_api, app


def test_get_settings_returns_resolved_payload(monkeypatch):
    settings_api, app = _client(monkeypatch)
    from backend.models.settings_schemas import AppSettings, FeedConfig

    async def fake_load():
        return AppSettings(gemini_api_key="k", feeds=[
            FeedConfig(url="http://audio.liveatc.net/kjfk9_s", airport_code="KJFK", lat=40.64, lon=-73.78)
        ])
    monkeypatch.setattr(settings_api, "load_settings", fake_load)

    body = TestClient(app).get("/api/settings").json()
    assert body["gemini_api_key"] == "k"
    assert body["feeds"][0]["airport_code"] == "KJFK"
    assert body["feeds"][0]["lat"] == pytest.approx(40.64)


def test_put_rejects_non_liveatc_feed(monkeypatch):
    settings_api, app = _client(monkeypatch)
    resp = TestClient(app).put("/api/settings", json={
        "gemini_api_key": "k",
        "feeds": [{"url": "http://evil.example.com/x", "airport_code": "KJFK"}],
        "runtime": {},
    })
    assert resp.status_code == 400
    assert "liveatc" in resp.json()["detail"].lower()


def test_put_rejects_more_than_five_feeds(monkeypatch):
    settings_api, app = _client(monkeypatch)
    feeds = [{"url": f"http://audio.liveatc.net/k{i}", "airport_code": "KAAA"} for i in range(6)]
    resp = TestClient(app).put("/api/settings", json={"gemini_api_key": "k", "feeds": feeds, "runtime": {}})
    assert resp.status_code == 400
    assert "5" in resp.json()["detail"]


def test_put_saves_and_returns_resolved(monkeypatch):
    settings_api, app = _client(monkeypatch)
    from backend.models.settings_schemas import AppSettings

    captured = {}

    async def fake_save(payload: AppSettings):
        captured["payload"] = payload
        return payload
    monkeypatch.setattr(settings_api, "save_settings", fake_save)

    resp = TestClient(app).put("/api/settings", json={
        "gemini_api_key": "new-key",
        "feeds": [{"url": "http://audio.liveatc.net/kjfk9_s", "airport_code": "KJFK"}],
        "runtime": {"batch_interval_seconds": 120},
    })
    assert resp.status_code == 200
    assert captured["payload"].gemini_api_key == "new-key"
    assert resp.json()["runtime"]["batch_interval_seconds"] == 120


def test_verify_feed_rejects_disallowed_host_without_network(monkeypatch):
    settings_api, app = _client(monkeypatch)
    body = TestClient(app).post("/api/settings/verify-feed", json={"url": "http://evil.example.com/x"}).json()
    assert body["ok"] is False
    assert "liveatc" in body["reason"].lower()


def test_verify_feed_picks_audio_first(monkeypatch):
    settings_api, app = _client(monkeypatch)

    async def fake_probe(url):
        return (206, "audio/mpeg")

    monkeypatch.setattr(settings_api, "_probe", fake_probe)

    body = TestClient(app).post("/api/settings/verify-feed", json={
        "url": "https://www.liveatc.net/hlisten.php?mount=vhhh5&icao=vhhh"
    }).json()
    assert body["ok"] is True
    assert body["stream_url"] == "http://audio.liveatc.net/vhhh5"
    assert body["suggested_code"] == "VHHH"


def test_verify_feed_falls_back_to_feeds(monkeypatch):
    settings_api, app = _client(monkeypatch)

    async def fake_probe(url):
        if "audio.liveatc.net" in url:
            raise RuntimeError("audio down")
        return (200, "audio/mpeg")

    monkeypatch.setattr(settings_api, "_probe", fake_probe)

    body = TestClient(app).post("/api/settings/verify-feed", json={
        "url": "https://www.liveatc.net/hlisten.php?mount=vhhh5&icao=vhhh"
    }).json()
    assert body["ok"] is True
    assert body["stream_url"] == "http://feeds.liveatc.net/vhhh5"


def test_verify_feed_all_candidates_fail(monkeypatch):
    settings_api, app = _client(monkeypatch)

    async def fake_probe(url):
        raise RuntimeError("nope")

    monkeypatch.setattr(settings_api, "_probe", fake_probe)

    body = TestClient(app).post("/api/settings/verify-feed", json={
        "url": "http://audio.liveatc.net/vhhh5"
    }).json()
    assert body["ok"] is False
    assert body["stream_url"] is None


def test_put_message_mentions_verify_for_bad_host(monkeypatch):
    settings_api, app = _client(monkeypatch)
    resp = TestClient(app).put("/api/settings", json={
        "gemini_api_key": "k",
        "feeds": [{"url": "http://evil.example.com/x", "airport_code": "KJFK"}],
        "runtime": {},
    })
    assert resp.status_code == 400
    assert "liveatc" in resp.json()["detail"].lower()
