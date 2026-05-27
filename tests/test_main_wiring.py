"""App wiring: settings router mounted and CORS scoped to the dev frontend."""

import importlib
import sys


def _load_main(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "env-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://atc:atc@localhost:5432/atcmonitor")
    for mod in ("backend.config", "backend.main"):
        sys.modules.pop(mod, None)
    return importlib.import_module("backend.main")


def test_settings_routes_registered(monkeypatch):
    main = _load_main(monkeypatch)
    paths = {r.path for r in main.app.routes}
    assert "/api/settings" in paths
    assert "/api/settings/verify-feed" in paths


def test_cors_scoped_to_localhost_frontend(monkeypatch):
    main = _load_main(monkeypatch)
    cors = [m for m in main.app.user_middleware if "CORSMiddleware" in str(m.cls)][0]
    assert cors.kwargs["allow_origins"] == ["http://localhost:3000"]


def test_cors_reads_allowed_origins_env(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example.com,https://admin.example.com")
    main = _load_main(monkeypatch)
    cors = [m for m in main.app.user_middleware if "CORSMiddleware" in str(m.cls)][0]
    assert cors.kwargs["allow_origins"] == ["https://app.example.com", "https://admin.example.com"]
