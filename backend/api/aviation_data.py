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

from backend.core.airports import airport_geo
from backend.db.database import AsyncSessionLocal
from backend.db.models import AnalysisResultDB

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
    """Return the ADS-B snapshot captured at the time this result was analysed.

    Reads from the persisted result row, so snapshots survive restarts.
    """
    async with AsyncSessionLocal() as session:
        row = await session.get(AnalysisResultDB, result_id)
    if not row or not row.adsb_snapshot:
        return {"error": "No snapshot available for this result", "aircraft": []}
    return row.adsb_snapshot


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
    if "EMERG" in b: return "EMERGENCY"
    if "TFR" in b or "TEMPORARY FLIGHT RESTRICTION" in b: return "TFR"
    if "RWY" in b and ("CLSD" in b or "OUT OF SERVICE" in b):  return "RWY"
    if "TWY" in b and "CLSD" in b: return "TWY"
    if "NAVAID" in b or "ILS" in b or "VOR" in b or "NDB" in b: return "NAVAID"
    if "LASER" in b: return "LASER"
    if "CRANE" in b or "OBSTACLE" in b: return "OBS"
    return "GEN"


# aviationapi.com keys responses sometimes by the ICAO code, sometimes by the
# FAA 3-letter form. Build the list of candidate request/response keys for a
# given input — e.g. KSFO yields [("KSFO","KSFO"), ("KSFO","SFO"), ("SFO","SFO")].
def _notam_request_variants(code: str) -> list[tuple[str, str]]:
    code = code.upper()
    stripped = code.lstrip("K") if len(code) == 4 and code.startswith("K") else code
    variants: list[tuple[str, str]] = [(code, code)]
    if stripped != code:
        variants.append((code, stripped))
        variants.append((stripped, stripped))
    return variants


def _extract_notams_list(raw, response_key: str) -> list:
    """Pull the notam list out of aviationapi.com's response, which varies."""
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict):
        # Try the response_key we expect, then any case variant, then the
        # first list-valued entry — aviationapi has moved the key around.
        if isinstance(raw.get(response_key), list):
            return raw[response_key]
        for k, v in raw.items():
            if isinstance(v, list) and k.upper().endswith(response_key.upper()):
                return v
        for v in raw.values():
            if isinstance(v, list):
                return v
    return []


@router.get("/api/notam/{airport_code}")
async def get_notam(airport_code: str):
    code = airport_code.upper()
    cached = _NOTAM_CACHE.get(code)
    if cached and (time.time() - cached["fetched_at"]) < _SHORT_TTL:
        return cached["data"]

    notams_raw: list = []
    last_error: str | None = None
    chosen_variant: tuple[str, str] | None = None

    # A real browser UA — aviationapi.com periodically Cloudflares default UAs.
    headers = {
        "Accept": "application/json",
        "User-Agent": "Readback/1.0 (+https://github.com/) httpx",
    }

    try:
        async with httpx.AsyncClient(timeout=10, headers=headers) as client:
            for request_code, response_key in _notam_request_variants(code):
                try:
                    resp = await client.get(
                        "https://api.aviationapi.com/v1/notams",
                        params={"apt": request_code},
                    )
                    if resp.status_code >= 400:
                        last_error = f"HTTP {resp.status_code} for apt={request_code}"
                        print(f"[NOTAM] {code}: {last_error}", flush=True)
                        continue
                    raw = resp.json()
                except Exception as exc:
                    last_error = f"{type(exc).__name__}: {exc}"
                    print(f"[NOTAM] {code}: request apt={request_code} failed: {last_error}", flush=True)
                    continue

                candidate = _extract_notams_list(raw, response_key)
                if candidate:
                    notams_raw = candidate
                    chosen_variant = (request_code, response_key)
                    break
    except Exception as exc:
        # Outer guard for client construction etc.
        return {"error": f"{type(exc).__name__}: {exc}", "notams": []}

    if not notams_raw and last_error:
        # No variant produced rows AND we hit a real error — surface it.
        # Don't cache, so the next request retries.
        return {"error": last_error, "notams": []}

    if chosen_variant:
        print(f"[NOTAM] {code}: {len(notams_raw)} row(s) via apt={chosen_variant[0]}", flush=True)
    elif not notams_raw:
        # Successful upstream but empty for every variant — that's a real
        # "no NOTAMs" (or this airport isn't in aviationapi's coverage).
        # Cache so we don't hammer for an empty answer, but the UI can
        # disambiguate from a fetch failure via response shape.
        print(f"[NOTAM] {code}: upstream returned empty for every variant", flush=True)

    notams = []
    for n in (notams_raw or []):
        # aviationapi has churned through several body field names over the
        # years — try every one we've seen.
        body = (
            n.get("body")
            or n.get("text")
            or n.get("notam_body")
            or n.get("summary")
            or n.get("text_full")
            or n.get("notam_text")
            or ""
        )
        kw = _notam_keyword(body)
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
