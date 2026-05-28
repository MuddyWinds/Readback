import { expect, test } from "vitest";
import { getCardSeverity } from "./severity";
import type { AnalysisResult } from "./types";

function r(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    timestamp: "2026-05-20T01:00:00Z",
    airport_code: "KJFK",
    transcript: "t",
    is_standard: true,
    observations: [],
    summary: "s",
    confidence_score: 1,
    ...over,
  };
}

test("unassessable when assessable is false", () => {
  expect(getCardSeverity(r({ assessable: false }))).toBe("unassessable");
});

test("standard when no observations", () => {
  expect(getCardSeverity(r())).toBe("standard");
});

test("returns the max observation significance", () => {
  expect(getCardSeverity(r({
    observations: [
      {
        kind: "phraseology_note",
        note_type: "x",
        hfacs_level: "Unsafe Act",
        significance: "low",
        description: "",
      },
      {
        kind: "situational_event",
        note_type: "y",
        hfacs_level: "Unsafe Act",
        significance: "high",
        description: "",
      },
    ],
  }))).toBe("high");
});
