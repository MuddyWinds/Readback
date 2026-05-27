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
}

export function isActiveAt(from: string | null, to: string | null, ts: string): boolean {
  const t = new Date(ts.endsWith("Z") ? ts : ts + "Z").getTime();
  const f = from ? new Date(from).getTime() : 0;
  const e = to   ? new Date(to).getTime()   : Infinity;
  return t >= f && t <= e;
}

export function detectConflicts(aircraft: AdsbAircraft[]): ConflictResult[] {
  const airborne = aircraft.filter(
    a => !a.on_ground && a.latitude != null && a.longitude != null && a.altitude_m != null
  );
  const out: ConflictResult[] = [];
  for (let i = 0; i < airborne.length; i++) {
    for (let j = i + 1; j < airborne.length; j++) {
      const a = airborne[i], b = airborne[j];
      const avgLat  = ((a.latitude! + b.latitude!) / 2) * Math.PI / 180;
      const dlat    = (a.latitude!  - b.latitude!);
      const dlon    = (a.longitude! - b.longitude!) * Math.cos(avgLat);
      const distNm  = Math.sqrt(dlat * dlat + dlon * dlon) * 60;
      const altDiffFt = Math.abs((a.altitude_m! - b.altitude_m!) * 3.281);
      const level = distNm < 5 && altDiffFt < 1000  ? "SEPARATION LOSS"
                  : distNm < 10 && altDiffFt < 2000 ? "PROXIMITY WARNING"
                  : null;
      if (level) out.push({ callA: a.callsign ?? a.icao24, callB: b.callsign ?? b.icao24,
        distNm, altDiffFt, level });
    }
  }
  return out;
}
