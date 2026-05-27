"""Airport-data generation from OurAirports rows (pure transform)."""

from scripts.build_airports_json import build


def _airport(**kw):
    base = {"id": "1", "ident": "KAAA", "type": "medium_airport",
            "name": "Test Field", "latitude_deg": "10.0", "longitude_deg": "20.0"}
    base.update(kw)
    return base


def _runway(airport_ref="1", **kw):
    base = {"airport_ref": airport_ref, "closed": "0",
            "le_ident": "09", "le_heading_degT": "90",
            "he_ident": "27", "he_heading_degT": "270"}
    base.update(kw)
    return base


def test_includes_fixed_wing_with_icao_and_parses_runways():
    out = build([_airport(id="1", ident="KAAA", type="small_airport")], [_runway("1")])
    assert "KAAA" in out
    assert out["KAAA"]["lat"] == 10.0 and out["KAAA"]["lon"] == 20.0
    idents = {r["ident"] for r in out["KAAA"]["runways"]}
    assert idents == {"09", "27"}


def test_excludes_closed_heliport_and_non_icao():
    rows = [
        _airport(id="1", ident="KAAA", type="closed_airport"),
        _airport(id="2", ident="KBBB", type="heliport"),
        _airport(id="3", ident="KCCC", type="seaplane_base"),
        _airport(id="4", ident="US-0001", type="small_airport"),
    ]
    assert build(rows, []) == {}


def test_skips_closed_runway_ends():
    out = build([_airport(id="1", ident="KAAA")], [_runway("1", closed="1")])
    assert out["KAAA"]["runways"] == []


def test_heading_falls_back_to_runway_number():
    rw = _runway("1", le_ident="04L", le_heading_degT="", he_ident="22R", he_heading_degT="")
    out = build([_airport(id="1", ident="KAAA")], [rw])
    by_ident = {r["ident"]: r["heading_deg"] for r in out["KAAA"]["runways"]}
    assert by_ident == {"04L": 40, "22R": 220}


def test_build_reports_skip_summary_by_reason():
    rows = [
        _airport(id="1", ident="KAAA", type="small_airport"),
        _airport(id="2", ident="KBBB", type="heliport"),
        _airport(id="3", ident="KCCC", type="balloonport"),
        _airport(id="4", ident="US-0001", type="small_airport"),
        _airport(id="5", ident="KDDD", type="small_airport", latitude_deg="x"),
    ]
    summary: dict[str, int] = {}
    out = build(rows, [], summary)
    assert set(out) == {"KAAA"}
    assert summary == {
        "written": 1, "excluded_type": 2, "other_type": 0,
        "non_icao": 1, "bad_coords": 1,
    }
