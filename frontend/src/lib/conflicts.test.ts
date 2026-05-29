import { expect, test } from "vitest";
import { isActiveAt, detectConflicts, type AdsbAircraft } from "./conflicts";

test("isActiveAt is true when ts falls within [from, to]", () => {
  expect(isActiveAt("2026-05-20T00:00:00Z", "2026-05-20T02:00:00Z", "2026-05-20T01:00:00Z")).toBe(true);
});
test("isActiveAt is false when ts is outside the window", () => {
  expect(isActiveAt("2026-05-20T00:00:00Z", "2026-05-20T02:00:00Z", "2026-05-20T03:00:00Z")).toBe(false);
});
test("detectConflicts returns an array (empty for no aircraft)", () => {
  expect(detectConflicts([])).toEqual([]);
});

// Helpers — build a minimal airborne aircraft near KSFO.
const KSFO = { lat: 37.62, lon: -122.38 };
function ac(callsign: string, lat: number, lon: number, altFt: number): AdsbAircraft {
  return {
    icao24: callsign.toLowerCase(),
    callsign,
    latitude: lat, longitude: lon,
    altitude_m: altFt / 3.281,
    on_ground: false,
    velocity_ms: 200, heading: 90, squawk: "1200",
  };
}

test("airportRadiusNm drops enroute traffic far from the field", () => {
  const here = ac("AAL100", 37.62,  -122.39,  5000);
  const near = ac("UAL200", 37.625, -122.385, 4800);
  // ~150 nm north — outside default 30 nm scope.
  const far1 = ac("DAL300", 39.50, -122.38,  35000);
  const far2 = ac("BAW400", 39.51, -122.39,  35000);
  const conflicts = detectConflicts([here, near, far1, far2], { airport: KSFO });
  expect(conflicts.map(c => `${c.callA}↔${c.callB}`)).toEqual(["AAL100↔UAL200"]);
});

test("terminal 4 nm / 800 ft is PROXIMITY, not a SEPARATION LOSS", () => {
  // Under the old flat 5 nm / 1000 ft rule this fired SEPARATION LOSS, which
  // over-states the issue in a TMA where the radar standard is 3 nm.
  const a = ac("AAL100", 37.62,  -122.38, 4000);
  const b = ac("UAL200", 37.685, -122.38, 4800); // ~3.9 nm north, 800 ft up
  const conflicts = detectConflicts([a, b], { airport: KSFO });
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].level).toBe("PROXIMITY WARNING");
});

test("terminal 2 nm / 500 ft IS flagged as a separation loss", () => {
  const a = ac("AAL100", 37.62,  -122.38, 4000);
  const b = ac("UAL200", 37.65,  -122.38, 4400); // ~1.8 nm north, 400 ft up
  const conflicts = detectConflicts([a, b], { airport: KSFO });
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].level).toBe("SEPARATION LOSS");
});

test("subjectCallsign filters to pairs involving the subject and puts subject on the left", () => {
  // Four aircraft: a near-pair containing the subject, and a near-pair that
  // doesn't. The non-subject pair must not appear.
  const subj      = ac("AAL123", 37.62,  -122.38, 4000);
  const near      = ac("UAL200", 37.625, -122.385, 4400); // ~0.4 nm from subject
  const otherA    = ac("DAL300", 37.78,  -122.38, 4500);  // ~9.6 nm north of subject
  const otherB    = ac("BAW400", 37.785, -122.385, 4500); // ~0.4 nm from DAL300, ~10 nm from subject
  const conflicts = detectConflicts([subj, near, otherA, otherB], {
    airport: KSFO,
    subjectCallsign: "AAL123",
  });
  expect(conflicts.map(c => `${c.callA}↔${c.callB}`)).toEqual(["AAL123↔UAL200"]);
  expect(conflicts[0].involvesSubject).toBe(true);
});

test("subjectCallsign normalizes leading zeros so AAL123 matches AAL0123 from OpenSky", () => {
  const subj   = ac("AAL0123", 37.62, -122.38, 4000);
  const other  = ac("UAL200",  37.65, -122.38, 4400);
  const conflicts = detectConflicts([subj, other], {
    airport: KSFO,
    subjectCallsign: "AAL123",
  });
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0].involvesSubject).toBe(true);
  expect(conflicts[0].callA).toBe("AAL0123"); // raw label preserved
});
