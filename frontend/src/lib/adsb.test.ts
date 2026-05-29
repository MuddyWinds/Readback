import { expect, test } from "vitest";
import { angularDiff, bearingTo, buildMonitorIndex, calcDistNm, hpaToInhg, activeRunway } from "./adsb";
import type { AnalysisResult } from "./types";

test("angularDiff is the smallest signed/magnitude difference on a circle", () => {
  expect(angularDiff(10, 350)).toBeCloseTo(20, 0); // 20°, not 340°
});

test("calcDistNm ~ 60nm per degree of latitude", () => {
  expect(calcDistNm(0, 0, 1, 0)).toBeGreaterThan(59);
  expect(calcDistNm(0, 0, 1, 0)).toBeLessThan(61);
});

test("bearingTo due north is ~0/360 and due east is ~90", () => {
  expect(bearingTo(0, 0, 1, 0)).toBeCloseTo(0, 0);
  expect(bearingTo(0, 0, 0, 1)).toBeCloseTo(90, 0);
});

test("hpaToInhg converts standard pressure", () => {
  expect(hpaToInhg(1013.25)).toBe("29.92");
});

test("activeRunway picks the runway whose heading best matches the wind", () => {
  const runways = [{ ident: "09", heading_deg: 90 }, { ident: "27", heading_deg: 270 }];
  expect(activeRunway(270, runways)).toBe("27");
});

// Regression: VHHH (and other airports) sometimes produce results whose
// `enrichment.callsign_detected` is not a string despite the type — the LLM
// can emit arrays/numbers/objects. The earlier code did
// `(enrichment.callsign_detected ?? regex)?.toUpperCase()`, which crashed
// because `??` only short-circuits on null/undefined. The fix guards with
// `typeof === "string"` so non-string enrichment values fall through to the
// regex fallback instead of crashing the entire AirportSidebar.
test("buildMonitorIndex falls through to regex when callsign_detected is not a string", () => {
  const base = {
    timestamp: "2026-05-28T00:00:00Z",
    airport_code: "VHHH",
    is_standard: true,
    observations: [],
    summary: "",
    confidence_score: 1,
  };
  // Cast through `any` because we're testing how the runtime handles type
  // violations the schema claims are impossible.
  const results = [
    { ...base, id: 1, transcript: "CPA123 cleared to land",
      enrichment: { callsign_detected: ["CPA123"] as any } } as any as AnalysisResult,
    { ...base, id: 2, transcript: "DAL456 contact tower",
      enrichment: { callsign_detected: 456 as any } } as any as AnalysisResult,
    { ...base, id: 3, transcript: "UAL789 taxi to gate",
      enrichment: { callsign_detected: null } } as any as AnalysisResult,
  ];

  // Must not throw.
  const idx = buildMonitorIndex(results, "VHHH");

  // All three should be indexed by the regex-extracted callsign.
  expect(idx.has("CPA123")).toBe(true);
  expect(idx.has("DAL456")).toBe(true);
  expect(idx.has("UAL789")).toBe(true);
});

test("buildMonitorIndex uses the enrichment callsign when it is a string", () => {
  const r = {
    id: 1,
    timestamp: "2026-05-28T00:00:00Z",
    airport_code: "VHHH",
    transcript: "garbled audio",
    is_standard: true,
    observations: [],
    summary: "",
    confidence_score: 1,
    enrichment: { callsign_detected: "cpa999" },
  } as any as AnalysisResult;
  const idx = buildMonitorIndex([r], "VHHH");
  expect(idx.has("CPA999")).toBe(true); // upper-cased
});
