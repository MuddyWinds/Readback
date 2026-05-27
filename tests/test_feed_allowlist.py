"""Shared LiveATC SSRF allowlist."""

from backend.core.feed_allowlist import is_allowed_feed_url
from backend.core.feed_allowlist import is_allowed_input_url


def test_liveatc_hosts_allowed():
    assert is_allowed_feed_url("http://audio.liveatc.net/kjfk9_s")
    assert is_allowed_feed_url("https://feeds.liveatc.net/ksfo")


def test_other_schemes_and_hosts_rejected():
    assert not is_allowed_feed_url("file:///etc/passwd")
    assert not is_allowed_feed_url("http://169.254.169.254/latest/meta-data")
    assert not is_allowed_feed_url("http://evil.example.com/stream")
    assert not is_allowed_feed_url("not a url")


def test_input_allows_listen_pages_and_streams():
    assert is_allowed_input_url("https://www.liveatc.net/hlisten.php?mount=vhhh5&icao=vhhh")
    assert is_allowed_input_url("https://liveatc.net/play/vhhh5.pls")
    assert is_allowed_input_url("http://audio.liveatc.net/vhhh5")
    assert is_allowed_input_url("https://feeds.liveatc.net/ksfo")


def test_input_rejects_other_hosts_and_schemes():
    assert not is_allowed_input_url("http://evil.example.com/x")
    assert not is_allowed_input_url("file:///etc/passwd")
    assert not is_allowed_input_url("not a url")
