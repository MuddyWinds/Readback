"""LiveATC listen-page / stream URL normalization."""

from backend.core.feed_url import normalize_feed_url


def test_query_param_listen_page_yields_audio_first_and_icao():
    n = normalize_feed_url("https://www.liveatc.net/hlisten.php?mount=vhhh5&icao=vhhh")
    assert n.candidates == [
        "http://audio.liveatc.net/vhhh5",
        "http://feeds.liveatc.net/vhhh5",
    ]
    assert n.suggested_icao == "VHHH"


def test_play_pls_path_form_yields_candidates_without_icao():
    n = normalize_feed_url("https://www.liveatc.net/play/vhhh5.pls")
    assert n.candidates == [
        "http://audio.liveatc.net/vhhh5",
        "http://feeds.liveatc.net/vhhh5",
    ]
    assert n.suggested_icao == ""


def test_play_m3u_path_form_supported():
    n = normalize_feed_url("https://www.liveatc.net/play/ksfo_twr.m3u")
    assert n.candidates[0] == "http://audio.liveatc.net/ksfo_twr"


def test_existing_stream_url_passthrough_with_suggested_code():
    n = normalize_feed_url("http://audio.liveatc.net/vhhh5")
    assert n.candidates == ["http://audio.liveatc.net/vhhh5"]
    assert n.suggested_icao == "VHHH"


def test_malformed_mount_rejected():
    for bad in (
        "https://www.liveatc.net/hlisten.php?mount=../etc/passwd",
        "https://www.liveatc.net/hlisten.php?mount=a/b",
        "https://www.liveatc.net/hlisten.php?mount=",
        "https://www.liveatc.net/play/..%2f.pls",
    ):
        assert normalize_feed_url(bad).candidates == [], bad


def test_unknown_host_yields_no_candidates():
    assert normalize_feed_url("http://evil.example.com/x").candidates == []
    assert normalize_feed_url("not a url").candidates == []
    assert normalize_feed_url("").candidates == []
