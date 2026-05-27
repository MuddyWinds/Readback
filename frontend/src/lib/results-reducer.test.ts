import { expect, test } from "@jest/globals";

import { applyAnalysis } from "./results-reducer";
import { AnalysisResult } from "../components/LiveFeed";

function makeResult(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    id: 1,
    timestamp: "2026-05-20T01:00:00Z",
    airport_code: "KJFK",
    transcript: "t",
    is_standard: true,
    observations: [],
    summary: "s",
    confidence_score: 0.9,
    ...over,
  };
}

test("prepends onto an empty/undefined cache without throwing", () => {
  const msg = { data: makeResult() };
  expect(applyAnalysis(undefined, msg, "all")).toEqual([msg.data]);
});

test("prepends newest-first and caps the list at 500", () => {
  const prev = Array.from({ length: 500 }, (_, i) => makeResult({ id: i + 100 }));
  const msg = { data: makeResult({ id: 1 }) };
  const next = applyAnalysis(prev, msg, "all");
  expect(next).toHaveLength(500);
  expect(next[0].id).toBe(1);
});

test("drops a message older than the active date filter", () => {
  const prev = [makeResult({ id: 2 })];
  const old = { data: makeResult({ id: 3, timestamp: "2000-01-01T00:00:00Z" }) };
  expect(applyAnalysis(prev, old, "today")).toBe(prev);
});

test("keeps a recent message under a date filter", () => {
  const prev: AnalysisResult[] = [];
  const fresh = { data: makeResult({ id: 4, timestamp: new Date().toISOString() }) };
  expect(applyAnalysis(prev, fresh, "today")).toHaveLength(1);
});
