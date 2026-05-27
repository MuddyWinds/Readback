"""Shared LiveATC SSRF allowlist."""

from backend.core.feed_allowlist import is_allowed_feed_url


def test_liveatc_hosts_allowed():
    assert is_allowed_feed_url("http://audio.liveatc.net/kjfk9_s")
    assert is_allowed_feed_url("https://feeds.liveatc.net/ksfo")


def test_other_schemes_and_hosts_rejected():
    assert not is_allowed_feed_url("file:///etc/passwd")
    assert not is_allowed_feed_url("http://169.254.169.254/latest/meta-data")
    assert not is_allowed_feed_url("http://evil.example.com/stream")
    assert not is_allowed_feed_url("not a url")
