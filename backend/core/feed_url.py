from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse

from backend.core.airports import suggest_airport_code
from backend.core.feed_allowlist import is_allowed_feed_url

_LISTEN_HOSTS = ("www.liveatc.net", "liveatc.net")
_MOUNT_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_PLAY_PATH_RE = re.compile(r"^/play/([A-Za-z0-9_-]+)\.(?:pls|m3u)$", re.IGNORECASE)


@dataclass
class NormalizedFeed:
    """Ordered stream-URL candidates to probe, plus a best-guess ICAO."""

    candidates: list[str] = field(default_factory=list)
    suggested_icao: str = ""


def _candidates_for_mount(mount: str) -> list[str]:
    # Audio first (verified working); feeds as fallback.
    return [f"http://audio.liveatc.net/{mount}", f"http://feeds.liveatc.net/{mount}"]


def normalize_feed_url(raw: str) -> NormalizedFeed:
    raw = (raw or "").strip()
    try:
        parsed = urlparse(raw)
    except ValueError:
        return NormalizedFeed()

    if is_allowed_feed_url(raw):
        return NormalizedFeed(candidates=[raw], suggested_icao=suggest_airport_code(raw))

    host = (parsed.hostname or "").lower()
    if host in _LISTEN_HOSTS:
        mount = ""
        icao = ""
        qs = parse_qs(parsed.query)
        if qs.get("mount"):
            mount = qs["mount"][0].strip()
            if qs.get("icao"):
                icao = qs["icao"][0].strip().upper()
        else:
            m = _PLAY_PATH_RE.match(parsed.path or "")
            if m:
                mount = m.group(1)
        if mount and _MOUNT_RE.match(mount):
            return NormalizedFeed(candidates=_candidates_for_mount(mount), suggested_icao=icao)

    return NormalizedFeed()
