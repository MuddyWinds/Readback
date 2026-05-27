"""Regenerate backend/data/airports.json from OurAirports CSVs."""
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


def _fetch_csv(name: str) -> list[dict]:
    resp = httpx.get(f"{BASE}/{name}", timeout=60)
    resp.raise_for_status()
    return list(csv.DictReader(io.StringIO(resp.text)))


def main() -> None:
    airports_rows = _fetch_csv("airports.csv")
    runway_rows = _fetch_csv("runways.csv")

    runways_by_airport: dict[str, list[dict]] = {}
    for r in runway_rows:
        for ident_key, hdg_key in (("le_ident", "le_heading_degT"), ("he_ident", "he_heading_degT")):
            ident = (r.get(ident_key) or "").strip()
            hdg = (r.get(hdg_key) or "").strip()
            if not ident or not hdg:
                continue
            try:
                heading = round(float(hdg))
            except ValueError:
                continue
            runways_by_airport.setdefault(r["airport_ref"], []).append(
                {"ident": ident, "heading_deg": heading}
            )

    out: dict[str, dict] = {}
    for a in airports_rows:
        if a.get("type") not in ("large_airport", "medium_airport"):
            continue
        icao = (a.get("ident") or "").strip().upper()
        if not ICAO_RE.match(icao):
            continue
        try:
            lat = float(a["latitude_deg"])
            lon = float(a["longitude_deg"])
        except (KeyError, ValueError):
            continue
        out[icao] = {
            "name": a.get("name") or icao,
            "lat": round(lat, 4),
            "lon": round(lon, 4),
            "runways": runways_by_airport.get(a.get("id"), []),
        }

    OUT.write_text(json.dumps(out, indent=0, sort_keys=True), encoding="utf-8")
    print(f"Wrote {len(out)} airports -> {OUT}")


if __name__ == "__main__":
    main()
