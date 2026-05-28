import { expect, test } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { handleSocketMessage } from "./useLiveSocket";
import type { AnalysisResult } from "../lib/types";

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

test("an analysis message prepends into the active ['results', dateFilter] key", () => {
  const qc = new QueryClient();
  const data = makeResult({ id: 7 });
  handleSocketMessage(qc, JSON.stringify({ type: "analysis", data }), "all");
  expect(qc.getQueryData<AnalysisResult[]>(["results", "all"])).toEqual([data]);
});

test("an analysis message writes only into the active filter key, not others", () => {
  const qc = new QueryClient();
  const data = makeResult({ id: 8, timestamp: new Date().toISOString() });
  handleSocketMessage(qc, JSON.stringify({ type: "analysis", data }), "7d");
  expect(qc.getQueryData(["results", "7d"])).toEqual([data]);
  expect(qc.getQueryData(["results", "all"])).toBeUndefined();
});

test("an analysis message invokes the optional onAnalysis callback with the payload", () => {
  const qc = new QueryClient();
  const data = makeResult({ id: 9 });
  let seen: AnalysisResult | null = null;
  handleSocketMessage(qc, JSON.stringify({ type: "analysis", data }), "all", (d) => { seen = d; });
  expect(seen).toEqual(data);
});

test("a pipeline message replaces the ['pipelineStatus'] key", () => {
  const qc = new QueryClient();
  const status = { queued_transcripts: 3 };
  handleSocketMessage(qc, JSON.stringify({ type: "pipeline", data: status }), "all");
  expect(qc.getQueryData(["pipelineStatus"])).toEqual(status);
});
