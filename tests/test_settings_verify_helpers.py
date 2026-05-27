"""Content-type classification for the verify-feed probe."""

from backend.api.settings import _looks_like_audio


def test_audioish_content_types_pass():
    assert _looks_like_audio("audio/mpeg")
    assert _looks_like_audio("audio/aac")
    assert _looks_like_audio("application/octet-stream")
    assert _looks_like_audio("video/mpeg")


def test_non_audio_content_types_fail():
    assert not _looks_like_audio("text/html")
    assert not _looks_like_audio("application/json")
    assert not _looks_like_audio("")
