import type { AnalysisResult } from "./types";
import { normalizeCallsign } from "./callsign";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RawAircraft {
  icao24:      string;
  callsign:    string | null;
  latitude:    number | null;
  longitude:   number | null;
  altitude_m:  number | null;
  on_ground:   boolean;
  velocity_ms: number | null;
  heading:     number | null;
  squawk:      string | null;
}

export interface AircraftInfo {
  id:          string;
  callsign:    string;
  lat:         number;
  lon:         number;
  altFt:       number | null;
  speedKt:     number | null;
  heading:     number | null;
  onGround:    boolean;
  distNm:      number;
  phase:       "arr" | "dep" | "gnd" | "enr";
  // Phraseology linkage — populated after cross-referencing with results
  monitored:   boolean;
  standard:    boolean | null;   // null = not assessed
  lastEvent:   string | null;    // note_type or "Standard"
  resultId:    number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const CAT_LABEL: Record<string, string> = {
  VFR: "Visual Flight Rules", MVFR: "Marginal VFR",
  IFR: "Instrument Flight Rules", LIFR: "Low IFR",
};

export const PHASE_LABEL: Record<string, string> = {
  arr: "ARR", dep: "DEP", gnd: "GND", enr: "ENR",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function angularDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function bearingTo(fromLat: number, fromLon: number, toLat: number, toLon: number): number {
  const dLon = (toLon - fromLon) * Math.PI / 180;
  const la1  = fromLat * Math.PI / 180, la2 = toLat * Math.PI / 180;
  const y    = Math.sin(dLon) * Math.cos(la2);
  const x    = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function calcDistNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2 +
               Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return Math.asin(Math.sqrt(Math.min(1, a))) * 2 * 180 * 60 / Math.PI;
}

export function detectPhase(
  onGround: boolean, altFt: number | null, heading: number | null,
  acLat: number, acLon: number, apLat: number, apLon: number,
): AircraftInfo["phase"] {
  if (onGround) return "gnd";
  if (altFt == null || heading == null) return "enr";
  if (altFt > 10_000) return "enr";
  return angularDiff(heading, bearingTo(acLat, acLon, apLat, apLon)) < 90 ? "arr" : "dep";
}

/** Extract all callsigns seen in analysis results for this airport. */
export function buildMonitorIndex(
  results: AnalysisResult[],
  airportCode: string,
): Map<string, { standard: boolean | null; lastEvent: string | null; resultId: number | null }> {
  const idx = new Map<string, { standard: boolean | null; lastEvent: string | null; resultId: number | null }>();
  // Walk newest-first so the latest event wins
  const airportResults = results
    .filter(r => r.airport_code === airportCode)
    .slice()
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  for (const r of airportResults) {
    // Try enrichment callsign first, then regex fallback. `normalizeCallsign`
    // also handles the case where the LLM emitted an array/number/object —
    // those return null and we fall through to the regex.
    const enrichmentCs = normalizeCallsign(r.enrichment?.callsign_detected as unknown as string | null | undefined);
    const regexHit = r.transcript?.toUpperCase().match(/\b([A-Z]{2,3}\d{1,4}[A-Z]?|N\d{4,5}[A-Z]{0,2})\b/)?.[1];
    const cs = enrichmentCs ?? normalizeCallsign(regexHit);
    if (!cs) continue;
    if (idx.has(cs)) continue; // keep newest
    const topObservation = (r.observations ?? [])[0];
    idx.set(cs, {
      standard:  r.assessable === false ? null : (r.is_standard ?? null),
      lastEvent:  topObservation?.note_type ?? (r.is_standard ? "Standard" : null),
      resultId:   r.id ?? null,
    });
  }
  return idx;
}

export function processAdsb(
  raw:         RawAircraft[],
  apLat:       number,
  apLon:       number,
  monitorIdx:  Map<string, { standard: boolean | null; lastEvent: string | null; resultId: number | null }>,
): AircraftInfo[] {
  return raw
    .filter(a => a.latitude != null && a.longitude != null)
    .map(a => {
      const lat     = a.latitude!;
      const lon     = a.longitude!;
      const altFt   = a.altitude_m  != null ? Math.round(a.altitude_m  * 3.28084) : null;
      const speedKt = a.velocity_ms != null ? Math.round(a.velocity_ms * 1.94384) : null;
      // Normalize the ADS-B callsign so it matches our monitorIdx keys —
      // OpenSky sometimes returns the zero-padded form ("AAL0123") while the
      // monitorIdx is keyed by the normalized form ("AAL123").
      const rawCs   = (a.callsign ?? a.icao24 ?? "?").trim().toUpperCase();
      const cs      = normalizeCallsign(rawCs) ?? rawCs;
      const match   = monitorIdx.get(cs);
      return {
        id:        a.icao24,
        callsign:  cs,
        lat, lon, altFt, speedKt,
        heading:   a.heading,
        onGround:  a.on_ground,
        distNm:    calcDistNm(lat, lon, apLat, apLon),
        phase:     detectPhase(a.on_ground, altFt, a.heading, lat, lon, apLat, apLon),
        monitored: !!match,
        standard: match?.standard ?? null,
        lastEvent: match?.lastEvent ?? null,
        resultId:  match?.resultId ?? null,
      };
    })
    .sort((a, b) => {
      // Monitored aircraft always float to top
      if (a.monitored !== b.monitored) return a.monitored ? -1 : 1;
      return a.distNm - b.distNm;
    });
}

export function activeRunway(windDir: number | null, runways: { ident: string; heading_deg: number }[]): string | null {
  if (windDir == null || runways.length === 0) return null;
  let best: { id: string; diff: number } | null = null;
  for (const { ident, heading_deg } of runways) {
    const diff = angularDiff(heading_deg, windDir);
    if (!best || diff < best.diff) best = { id: ident, diff };
  }
  return best?.id ?? null;
}

export function deriveCeiling(clouds: { cover: string; base: number }[] | null): number | null {
  if (!clouds) return null;
  const layers = clouds.filter(c => c.cover === "BKN" || c.cover === "OVC").map(c => c.base).sort((a, b) => a - b);
  return layers[0] ?? null;
}

export function hpaToInhg(hpa: number): string { return (hpa * 0.02953).toFixed(2); }
