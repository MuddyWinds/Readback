import { expect, test } from "@jest/globals";
import { buildReportText } from "./report";
import { AnalysisResult } from "./types";
function r(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return { id: 1, timestamp: "2026-05-20T01:00:00Z", airport_code: "KJFK", transcript: "tower 123",
    is_standard: true, observations: [], summary: "all normal", confidence_score: 1, ...over };
}
test("buildReportText includes the airport code and summary", () => {
  const txt = buildReportText(r(), "DAL123");
  expect(txt).toContain("KJFK");
  expect(txt).toContain("all normal");
});
test("buildReportText is a non-empty string when callsign is null", () => {
  expect(buildReportText(r(), null).length).toBeGreaterThan(0);
});
