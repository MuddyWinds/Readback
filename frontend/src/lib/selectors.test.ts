import { expect, test } from "vitest";
import { severityCounts } from "./selectors";
import type { AnalysisResult } from "./types";

function r(code: string, sev: "standard" | "high"): AnalysisResult {
  const observations = sev === "high"
    ? [{
      kind: "situational_event" as const,
      note_type: "x",
      hfacs_level: "Unsafe Act",
      significance: "high" as const,
      description: "",
    }]
    : [];
  return {
    timestamp: "2026-05-20T01:00:00Z",
    airport_code: code,
    transcript: "t",
    is_standard: sev === "standard",
    observations,
    summary: "s",
    confidence_score: 1,
  };
}

test("counts by severity across all airports", () => {
  const c = severityCounts([r("KJFK", "high"), r("KJFK", "standard"), r("KATL", "high")], "all");
  expect(c.all).toBe(3);
  expect(c.high).toBe(2);
  expect(c.standard).toBe(1);
});

test("scopes counts to a single airport", () => {
  const c = severityCounts([r("KJFK", "high"), r("KATL", "high")], "KJFK");
  expect(c.all).toBe(1);
  expect(c.high).toBe(1);
});
