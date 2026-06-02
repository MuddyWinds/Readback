import { expect, test, describe, it } from "vitest";
import { shouldAlert, resolveNavTarget, resolveAggregateNavTarget } from "./alerts";
import type { AnalysisResult } from "./types";

function r(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return { id: 7, timestamp: "2026-05-20T01:00:00Z", airport_code: "KJFK", transcript: "t",
    is_standard: true, observations: [], summary: "s", confidence_score: 1, ...over };
}
const obs = (significance: "low" | "medium" | "high" | "critical") =>
  ({ kind: "situational_event" as const, note_type: "x", hfacs_level: "Unsafe Act", significance, description: "" });

test("shouldAlert: high meets the default 'high' floor", () => {
  expect(shouldAlert("high", "high")).toBe(true);
  expect(shouldAlert("critical", "high")).toBe(true);
});

test("shouldAlert: medium does not meet the 'high' floor", () => {
  expect(shouldAlert("medium", "high")).toBe(false);
});

test("shouldAlert: standard/unassessable never alert", () => {
  expect(shouldAlert("standard", "low")).toBe(false);
  expect(shouldAlert("unassessable", "low")).toBe(false);
});

test("shouldAlert: a lower floor admits lower severities", () => {
  expect(shouldAlert("low", "low")).toBe(true);
  expect(shouldAlert("medium", "low")).toBe(true);
});

test("resolveNavTarget targets the airport + card, keeps an 'all' filter", () => {
  const t = resolveNavTarget(r({ id: 7, airport_code: "KATL", observations: [obs("high")] }), "all");
  expect(t).toEqual({ airportFilter: "KATL", severityFilter: "all", sidebarAirport: "KATL", resultId: 7 });
});

test("resolveNavTarget keeps a matching severity filter", () => {
  const t = resolveNavTarget(r({ observations: [obs("high")] }), "high");
  expect(t.severityFilter).toBe("high");
});

test("resolveNavTarget relaxes a filter that would hide the card", () => {
  const t = resolveNavTarget(r({ observations: [obs("high")] }), "low");
  expect(t.severityFilter).toBe("all");
});

describe("resolveAggregateNavTarget", () => {
  it("airport row → airport filter, severity all, no note type", () => {
    expect(resolveAggregateNavTarget({ airport: "KSFO" })).toEqual({
      airportFilter: "KSFO", severityFilter: "all", noteTypeFilter: null, sidebarAirport: "KSFO",
    });
  });
  it("error-type row → note-type filter, severity all, no airport scope", () => {
    // note_type values are DISPLAY strings, e.g. "Read-back Error"
    expect(resolveAggregateNavTarget({ noteType: "Read-back Error" })).toEqual({
      airportFilter: "all", severityFilter: "all", noteTypeFilter: "Read-back Error", sidebarAirport: null,
    });
  });
});
