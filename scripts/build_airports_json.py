"""Regenerate backend/data/airports.json from OurAirports CSVs.

Data source: OurAirports (https://ourairports.com/data/), public domain.
Includes operational fixed-wing airports (large/medium/small) that have a
4-letter ICAO code; explicitly excludes closed_airport, heliport,
seaplane_base, balloonport.
"""
from __future__ import annotations

import csv
import io
import json
import re
from pathlib import Path

import httpx

BASE = "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main"
OUT = Path(__file__).resolve().parent.parent / "backend" / "data" / "airports.json"
ICAO_RE = re.compile(r"^[A-Z]{4}$")
RWY_NUM_RE = re.compile(r"(\d{1,2})")
INCLUDE_TYPES = {"large_airport", "medium_airport", "small_airport"}
EXCLUDE_TYPES = {"closed_airport", "heliport", "seaplane_base", "balloonport"}


def _fetch_csv(name: str) -> list[dict]:
    resp = httpx.get(f"{BASE}/{name}", timeout=60)
    resp.raise_for_status()
    return list(csv.DictReader(io.StringIO(resp.text)))


def _heading_from_ident(ident: str) -> int | None:
    m = RWY_NUM_RE.match(ident)
    if not m:
        return None
    return (int(m.group(1)) % 36) * 10


def _runways_by_airport(runway_rows: list[dict]) -> dict[str, list[dict]]:
    by_airport: dict[str, list[dict]] = {}
    for r in runway_rows:
        if (r.get("closed") or "").strip() == "1":
            continue
        for ident_key, hdg_key in (("le_ident", "le_heading_degT"), ("he_ident", "he_heading_degT")):
            ident = (r.get(ident_key) or "").strip()
            if not ident:
                continue
            hdg = (r.get(hdg_key) or "").strip()
            heading: int | None = None
            if hdg:
                try:
                    heading = round(float(hdg))
                except ValueError:
                    heading = None
            if heading is None:
                heading = _heading_from_ident(ident)
            if heading is None:
                continue
            by_airport.setdefault(r.get("airport_ref", ""), []).append(
                {"ident": ident, "heading_deg": heading}
            )
    return by_airport


def build(
    airports_rows: list[dict],
    runway_rows: list[dict],
    summary: dict[str, int] | None = None,
) -> dict:
    """Transform OurAirports rows into the airports.json mapping."""
    skipped = {"excluded_type": 0, "other_type": 0, "non_icao": 0, "bad_coords": 0}
    runways_by_airport = _runways_by_airport(runway_rows)
    out: dict[str, dict] = {}
    for a in airports_rows:
        atype = a.get("type")
        if atype not in INCLUDE_TYPES:
            skipped["excluded_type" if atype in EXCLUDE_TYPES else "other_type"] += 1
            continue
        icao = (a.get("ident") or "").strip().upper()
        if not ICAO_RE.match(icao):
            skipped["non_icao"] += 1
            continue
        try:
            lat = float(a["latitude_deg"])
            lon = float(a["longitude_deg"])
        except (KeyError, ValueError):
            skipped["bad_coords"] += 1
            continue
        out[icao] = {
            "name": a.get("name") or icao,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "runways": runways_by_airport.get(a.get("id"), []),
        }
    if summary is not None:
        summary.clear()
        summary["written"] = len(out)
        summary.update(skipped)
    return out


def main() -> None:
    summary: dict[str, int] = {}
    out = build(_fetch_csv("airports.csv"), _fetch_csv("runways.csv"), summary)
    OUT.write_text(json.dumps(out, indent=0, sort_keys=True), encoding="utf-8")
    print(f"Wrote {summary['written']} airports -> {OUT}")
    for reason in ("excluded_type", "other_type", "non_icao", "bad_coords"):
        print(f"  skipped {summary[reason]} ({reason})")


if __name__ == "__main__":
    main()
