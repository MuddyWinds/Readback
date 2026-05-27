"""Bundled airport data resolution and the URL->code heuristic."""

import pytest

from backend.core import airports


def test_resolve_known_airport_returns_geo_and_runways():
    jfk = airports.resolve_airport("KJFK")
    assert jfk is not None
    assert jfk["lat"] == pytest.approx(40.64, abs=0.01)
    assert jfk["lon"] == pytest.approx(-73.78, abs=0.01)
    assert any(r["ident"] == "04L" for r in jfk["runways"])


def test_resolve_is_case_insensitive_and_unknown_is_none():
    assert airports.resolve_airport("kjfk") is not None
    assert airports.resolve_airport("ZZZZ") is None
    assert airports.resolve_airport("") is None


def test_airport_geo_returns_tuple_or_none():
    assert airports.airport_geo("KATL") == pytest.approx((33.64, -84.43), abs=0.01)
    assert airports.airport_geo("ZZZZ") is None


@pytest.mark.parametrize("url,expected", [
    ("http://audio.liveatc.net/kjfk9_s", "KJFK"),
    ("http://audio.liveatc.net/katl_twr", "KATL"),
    ("http://audio.liveatc.net/vhhh5", "VHHH"),
    ("http://audio.liveatc.net/klax_twr", "KLAX"),
    ("http://audio.liveatc.net/kord1n2_app_133625", "KORD"),
])
def test_suggest_airport_code_matches_spec_examples(url, expected):
    assert airports.suggest_airport_code(url) == expected
