import { expect, test } from "@jest/globals";
import { complianceRate, hfacsCounts, detectSpike, topNoteTypes } from "./analytics";
import { AnalysisResult } from "../components/LiveFeed";

function r(over: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    timestamp: new Date().toISOString(),
    airport_code: "KJFK",
    transcript: "t",
    is_standard: true,
    observations: [],
    summary: "s",
    confidence_score: 1,
    ...over,
  };
}

test("complianceRate ignores unassessable and is a 0-100 percentage", () => {
  const data = [r(), r(), r({ is_standard: false }), r({ assessable: false })];
  expect(complianceRate(data)).toBe(67);
});

test("complianceRate is null with no assessable data", () => {
  expect(complianceRate([r({ assessable: false })])).toBeNull();
});

test("hfacsCounts tallies observation hfacs_level", () => {
  const data = [r({
    observations: [
      {
        kind: "phraseology_note",
        note_type: "x",
        hfacs_level: "Unsafe Act",
        significance: "low",
        description: "",
      },
      {
        kind: "phraseology_note",
        note_type: "y",
        hfacs_level: "Unsafe Act",
        significance: "low",
        description: "",
      },
    ],
  })];
  expect(hfacsCounts(data)["Unsafe Act"]).toBe(2);
});

test("detectSpike flags a >=2x jump with >=2 recent non-standard", () => {
  const now = Date.now();
  const at = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
  const ns = (ts: string) => r({
    timestamp: ts,
    is_standard: false,
    observations: [
      {
        kind: "situational_event",
        note_type: "x",
        hfacs_level: "Unsafe Act",
        significance: "high",
        description: "",
      },
    ],
  });
  const data = [ns(at(5)), ns(at(10)), ns(at(45))];
  expect(detectSpike(data).isSpike).toBe(true);
});

test("topNoteTypes ranks note_type counts most-frequent first", () => {
  const obs = (nt: string) => ({
    kind: "phraseology_note" as const,
    note_type: nt,
    hfacs_level: "Unsafe Act",
    significance: "low" as const,
    description: "",
  });
  const data = [
    r({ observations: [obs("Read-back Error"), obs("Read-back Error")] }),
    r({ observations: [obs("Altitude Deviation")] }),
  ];
  expect(topNoteTypes(data)).toEqual([["Read-back Error", 2], ["Altitude Deviation", 1]]);
});
