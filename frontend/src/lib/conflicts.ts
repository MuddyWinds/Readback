import { normalizeCallsign } from "./callsign";

export interface AdsbAircraft {
  icao24: string; callsign: string | null;
  latitude: number | null; longitude: number | null;
  altitude_m: number | null; on_ground: boolean;
  velocity_ms: number | null; heading: number | null; squawk: string | null;
}

export interface ConflictResult {
  callA: string; callB: string;
  distNm: number; altDiffFt: number;
  level: "SEPARATION LOSS" | "PROXIMITY WARNING";
  /** True when one side normalizes to the same callsign as the subject we asked about. */
  involvesSubject: boolean;
}

export interface ConflictOptions {
  /** Airport reference point; pairs outside `airportRadiusNm` are dropped. */
  airport?: { lat: number; lon: number };
  /** Only keep pairs where at least one aircraft is within this nm of the airport. Default 30. */
  airportRadiusNm?: number;
  /**
   * Subject callsign — when supplied, only conflicts involving this aircraft
   * are returned, and `callA` is always normalized to the subject side so the
   * UI can read "<subject> vs <other>".
   */
  subjectCallsign?: string | null;
}

export function isActiveAt(from: string | null, to: string | null, ts: string): boolean {
  const t = new Date(ts.endsWith("Z") ? ts : ts + "Z").getTime();
  const f = from ? new Date(from).getTime() : 0;
  const e = to   ? new Date(to).getTime()   : Infinity;
  return t >= f && t <= e;
}

// Great-circle-ish distance for the small deltas we deal with inside a TMA.
function distNmDeg(latA: number, lonA: number, latB: number, lonB: number): number {
  const avgLat  = ((latA + latB) / 2) * Math.PI / 180;
  const dlat    = latA - latB;
  const dlon    = (lonA - lonB) * Math.cos(avgLat);
  return Math.sqrt(dlat * dlat + dlon * dlon) * 60;
}

/**
 * Separation thresholds vary by altitude band — the old flat
 * 5 nm / 1 kft rule fires constantly on cruise traffic where RVSM allows
 * 1 kft vertical separation and tracks routinely sit < 5 nm laterally.
 *
 *   Terminal (< 10 000 ft): 3 nm / 1 kft loss, 5 nm / 2 kft proximity.
 *   En-route (>= 10 000 ft, RVSM): 5 nm / 1 kft loss, 10 nm / 2 kft proximity.
 *
 * These are deliberately conservative — they tell the reviewer something is
 * worth a second look, not that an LOS occurred.
 */
function classifySeparation(distNm: number, altDiffFt: number, maxAltFt: number):
  "SEPARATION LOSS" | "PROXIMITY WARNING" | null
{
  const terminal = maxAltFt < 10_000;
  if (terminal) {
    if (distNm < 3  && altDiffFt < 1000) return "SEPARATION LOSS";
    if (distNm < 5  && altDiffFt < 2000) return "PROXIMITY WARNING";
  } else {
    if (distNm < 5  && altDiffFt < 1000) return "SEPARATION LOSS";
    if (distNm < 10 && altDiffFt < 2000) return "PROXIMITY WARNING";
  }
  return null;
}

export function detectConflicts(
  aircraft: AdsbAircraft[],
  options: ConflictOptions = {},
): ConflictResult[] {
  const { airport, airportRadiusNm = 30, subjectCallsign = null } = options;
  const subjectKey = normalizeCallsign(subjectCallsign);

  const airborne = aircraft.filter(
    a => !a.on_ground && a.latitude != null && a.longitude != null && a.altitude_m != null
  );

  // Pre-filter to traffic in the airport's terminal area so we don't render
  // FL350 enroute pairs in a card about a tower transmission.
  const inScope = airport
    ? airborne.filter(a => distNmDeg(a.latitude!, a.longitude!, airport.lat, airport.lon) <= airportRadiusNm)
    : airborne;

  const out: ConflictResult[] = [];
  for (let i = 0; i < inScope.length; i++) {
    for (let j = i + 1; j < inScope.length; j++) {
      const a = inScope[i], b = inScope[j];
      const distNm    = distNmDeg(a.latitude!, a.longitude!, b.latitude!, b.longitude!);
      const altA_ft   = a.altitude_m! * 3.281;
      const altB_ft   = b.altitude_m! * 3.281;
      const altDiffFt = Math.abs(altA_ft - altB_ft);
      const maxAltFt  = Math.max(altA_ft, altB_ft);
      const level = classifySeparation(distNm, altDiffFt, maxAltFt);
      if (!level) continue;

      const labelA = a.callsign ?? a.icao24;
      const labelB = b.callsign ?? b.icao24;
      const aIsSubject = subjectKey != null && normalizeCallsign(a.callsign) === subjectKey;
      const bIsSubject = subjectKey != null && normalizeCallsign(b.callsign) === subjectKey;

      if (subjectKey != null && !aIsSubject && !bIsSubject) continue;

      // Always render the subject on the left when present.
      const [callA, callB] = bIsSubject ? [labelB, labelA] : [labelA, labelB];
      out.push({
        callA, callB, distNm, altDiffFt, level,
        involvesSubject: aIsSubject || bIsSubject,
      });
    }
  }
  return out;
}
