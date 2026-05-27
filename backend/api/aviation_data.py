"""
External aviation data proxies: ADS-B, METAR, NOTAM, SIGMET/AIRMET/PIREP.

All endpoints cache their responses to avoid hammering free APIs:
  - ADS-B   : 60-second TTL per airport
  - METAR   : no cache (aviationweather.gov is fast and free)
  - NOTAM   : 5-minute TTL
  - Hazards : 5-minute TTL
"""

import time

import httpx
from fastapi import APIRouter

from backend.core.state import adsb_snapshots
from backend.core.airports import airport_geo

router = APIRouter()

_ADSB_CACHE: dict[str, dict] = {}
_ADSB_TTL = 60

_NOTAM_CACHE: dict[str, dict] = {}
_HAZARD_CACHE: dict[str, dict] = {}
_SHORT_TTL = 300


# ── ADS-B ──────────────────────────────────────────────────────────────────────

def _parse_opensky_states(raw: dict) -> list[dict]:
    return [
        {
            "icao24":     s[0],
            "callsign":   (s[1] or "").strip() or None,
            "latitude":   s[6],
            "longitude":  s[5],
            "altitude_m": s[7],
            "on_ground":  s[8],
            "velocity_ms": s[9],
            "heading":    s[10],
            "squawk":     s[14],
        }
        for s in (raw.get("states") or []) if len(s) >= 17
    ]


@router.get("/api/adsb-snapshot/{result_id}")
async def get_adsb_snapshot(result_id: int):
    """Return the ADS-B snapshot captured at the time this result was analysed."""
    snap = adsb_snapshots.get(result_id)
    if not snap:
        return {"error": "No snapshot available for this result", "aircraft": []}
    return snap


@router.get("/api/adsb/{airport_code}")
async def get_adsb(airport_code: str):
    code = airport_code.upper()
    geo = airport_geo(code)
    if not geo:
        return {"error": f"Unknown airport {code}", "aircraft": []}

    cached = _ADSB_CACHE.get(code)
    if cached and (time.time() - cached["fetched_at"]) < _ADSB_TTL:
        return cached["data"]

    lat, lon = geo
    url = (
        f"https://opensky-network.org/api/states/all"
        f"?lamin={lat-1.5}&lomin={lon-3.0}&lamax={lat+1.5}&lomax={lon+3.0}"
    )
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            aircraft = _parse_opensky_states(resp.json())
    except Exception as exc:
        return {"error": str(exc), "aircraft": []}

    result = {"airport": code, "fetched_at": time.time(), "aircraft": aircraft}
    _ADSB_CACHE[code] = {"data": result, "fetched_at": time.time()}
    return result


# ── METAR ──────────────────────────────────────────────────────────────────────

@router.get("/api/metar/{airport_code}")
async def get_metar(airport_code: str):
    url = f"https://aviationweather.gov/api/data/metar?ids={airport_code.upper()}&format=json"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            data = resp.json()
        if not data:
            return {"error": f"No METAR data for {airport_code.upper()}"}
        return data[0]
    except Exception as exc:
        return {"error": str(exc)}


# ── NOTAMs ─────────────────────────────────────────────────────────────────────

def _notam_keyword(body: str) -> str:
    b = body.upper()
    if "TFR" in b or "TEMPORARY FLIGHT RESTRICTION" in b: return "TFR"
    if "RWY" in b and ("CLSD" in b or "OUT OF SERVICE" in b):  return "RWY"
    if "TWY" in b and "CLSD" in b: return "TWY"
    if "NAVAID" in b or "ILS" in b or "VOR" in b or "NDB" in b: return "NAVAID"
    if "LASER" in b: return "LASER"
    if "CRANE" in b or "OBSTACLE" in b: return "OBS"
    return "GEN"


@router.get("/api/notam/{airport_code}")
async def get_notam(airport_code: str):
    code = airport_code.upper()
    cached = _NOTAM_CACHE.get(code)
    if cached and (time.time() - cached["fetched_at"]) < _SHORT_TTL:
        return cached["data"]

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.aviationapi.com/v1/notams",
                params={"apt": code},
                headers={"Accept": "application/json"},
            )
            raw = resp.json()
    except Exception as exc:
        return {"error": str(exc), "notams": []}

    if isinstance(raw, dict):
        notams_raw = raw.get(code, raw.get(code.lstrip("K"), []))
    elif isinstance(raw, list):
        notams_raw = raw
    else:
        notams_raw = []

    notams = []
    for n in (notams_raw or []):
        body = n.get("body") or n.get("text") or n.get("notam_body") or ""
        kw   = _notam_keyword(body)
        notams.append({
            "id":       n.get("notam_number") or n.get("notam_id") or "—",
            "body":     body,
            "keyword":  kw,
            "critical": kw in ("RWY", "TFR", "EMERGENCY"),
            "start":    n.get("start_date") or n.get("issue_date"),
            "end":      n.get("end_date") or n.get("expiry_date"),
        })

    result = {"airport": code, "fetched_at": time.time(), "notams": notams}
    _NOTAM_CACHE[code] = {"data": result, "fetched_at": time.time()}
    return result


# ── Hazards (SIGMET / AIRMET / PIREP) ─────────────────────────────────────────

@router.get("/api/hazards/{airport_code}")
async def get_hazards(airport_code: str):
    code = airport_code.upper()
    cached = _HAZARD_CACHE.get(code)
    if cached and (time.time() - cached["fetched_at"]) < _SHORT_TTL:
        return cached["data"]

    geo = airport_geo(code)
    if not geo:
        return {"error": f"Unknown airport {code}", "sigmets": [], "airmets": [], "pireps": []}

    lat, lon = geo
    bbox = f"{lon-5:.1f},{lat-5:.1f},{lon+5:.1f},{lat+5:.1f}"

    sigmets, airmets, pireps = [], [], []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r_sig = await client.get(
                "https://aviationweather.gov/api/data/airsigmet",
                params={"format": "json", "type": "sigmet", "bbox": bbox},
            )
            for s in (r_sig.json() or []):
                sigmets.append({
                    "type": "SIGMET", "hazard": s.get("hazard", ""),
                    "severity": s.get("severity", ""),
                    "from": s.get("validTimeFrom"), "to": s.get("validTimeTo"),
                    "alt_low": s.get("altitudeLow1"), "alt_high": s.get("altitudeHi1"),
                    "raw": s.get("rawAirSigmet", ""),
                })

            r_air = await client.get(
                "https://aviationweather.gov/api/data/airsigmet",
                params={"format": "json", "type": "airmet", "bbox": bbox},
            )
            for a in (r_air.json() or []):
                airmets.append({
                    "type": "AIRMET", "hazard": a.get("hazard", ""),
                    "from": a.get("validTimeFrom"), "to": a.get("validTimeTo"),
                    "raw": a.get("rawAirSigmet", ""),
                })

            r_pir = await client.get(
                "https://aviationweather.gov/api/data/pirep",
                params={"format": "json", "ids": code, "age": "2", "distance": "100"},
            )
            for p in (r_pir.json() or []):
                pireps.append({
                    "type": "PIREP", "obs_time": p.get("obsTime"),
                    "altitude": p.get("altitude"),
                    "turb": p.get("tbInt") or p.get("turbulenceCondition"),
                    "icing": p.get("icgInt") or p.get("icingCondition"),
                    "aircraft": p.get("acType") or p.get("aircraftRef"),
                    "raw": p.get("rawOb") or p.get("rawText", ""),
                })
    except Exception as exc:
        print(f"[Hazards] Fetch failed for {code}: {exc}", flush=True)

    result = {
        "airport": code, "fetched_at": time.time(),
        "sigmets": sigmets, "airmets": airmets, "pireps": pireps,
    }
    _HAZARD_CACHE[code] = {"data": result, "fetched_at": time.time()}
    return result
