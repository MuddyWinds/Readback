from __future__ import annotations

from urllib.parse import urlparse

ALLOWED_FEED_HOSTS = ("audio.liveatc.net", "feeds.liveatc.net")


def is_allowed_feed_url(feed_url: str) -> bool:
    try:
        parsed = urlparse(feed_url)
    except ValueError:
        return False
    if parsed.scheme not in ("http", "https"):
        return False
    return (parsed.hostname or "").lower() in ALLOWED_FEED_HOSTS
