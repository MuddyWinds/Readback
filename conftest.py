"""Pytest session bootstrap.

Loaded by pytest before any test module (and therefore before ``backend.config``
is first imported). Setting ``READBACK_TEST_ENV`` here makes pydantic ``Settings``
skip the local ``.env`` file so assertions see real env vars + code defaults,
not a developer's machine-specific CORS origins, DATABASE_URL, etc.
"""

import os

os.environ.setdefault("READBACK_TEST_ENV", "1")
# GEMINI_API_KEY is required and normally supplied by .env (now skipped above).
# Seed a placeholder so modules that import backend.config at collection time
# validate; tests needing a specific value still override via monkeypatch.
os.environ.setdefault("GEMINI_API_KEY", "test-key")
