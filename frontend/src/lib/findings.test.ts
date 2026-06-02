import { describe, it, expect } from "vitest";
import { orderedFindings, attributedCallsigns, findingPoints, buildDisplayFindings } from "./findings";
import type { Observation } from "./types";

function obs(kind: Observation["kind"], significance: Observation["significance"], note: string): Observation {
  return {
    kind, note_type: note, hfacs_level: "Unsafe Act",
    significance, description: "d", safety_pathway: null,
    relevant_regulation: null, transcript_excerpt: null, callsign: null,
  };
}

describe("orderedFindings", () => {
  it("orders phraseology notes before situational events, severity-desc within each, numbered 1..K", () => {
    const observations = [
      obs("situational_event", "low", "E-low"),
      obs("phraseology_note", "high", "P-high"),
      obs("situational_event", "critical", "E-crit"),
      obs("phraseology_note", "low", "P-low"),
    ];
    const out = orderedFindings(observations);
    expect(out.map(f => `${f.n}:${f.observation.note_type}`)).toEqual([
      "1:P-high", "2:P-low", "3:E-crit", "4:E-low",
    ]);
  });

  it("numbers a single-type card 1..K with no gaps", () => {
    const observations = [
      obs("phraseology_note", "medium", "A"),
      obs("phraseology_note", "high", "B"),
    ];
    expect(orderedFindings(observations).map(f => f.n)).toEqual([1, 2]);
  });

  it("returns an empty list for no observations", () => {
    expect(orderedFindings([])).toEqual([]);
  });
});

describe("buildDisplayFindings", () => {
  it("keeps real observations severity-sorted when no synthetic readback exists", () => {
    const out = buildDisplayFindings([
      obs("phraseology_note", "low", "Low"),
      obs("phraseology_note", "high", "High"),
    ], null);

    expect(out.map(f => [f.n, f.observation.note_type, f.synthetic])).toEqual([
      [1, "High", false],
      [2, "Low", false],
    ]);
  });

  it("inserts synthetic readback at finding #1 regardless of real severity", () => {
    const synthetic = obs("phraseology_note", "medium", "Read-back Error");
    const out = buildDisplayFindings([
      obs("phraseology_note", "critical", "Phraseology"),
      obs("phraseology_note", "high", "Other"),
    ], synthetic);

    expect(out.map(f => [f.n, f.observation.note_type, f.observation.significance, f.synthetic])).toEqual([
      [1, "Read-back Error", "medium", true],
      [2, "Phraseology", "critical", false],
      [3, "Other", "high", false],
    ]);
  });

  it("does not change orderedFindings real-observation behavior", () => {
    const out = orderedFindings([
      obs("phraseology_note", "low", "Low"),
      obs("phraseology_note", "high", "High"),
    ]);

    expect(out.map(f => [f.n, f.observation.note_type])).toEqual([
      [1, "High"],
      [2, "Low"],
    ]);
  });
});

describe("findingPoints", () => {
  it("expands detail_points into sub-numbered transcript-linked points", () => {
    const [finding] = orderedFindings([
      {
        ...obs("phraseology_note", "high", "Read-back Error"),
        description: "Pilot readback diverged from ATC instruction.",
        transcript_excerpt: "left heading 280",
        detail_points: [
          { text: "ATC assigned heading 270.", transcript_excerpt: "turn left heading 270" },
          { text: "Pilot read back heading 280.", transcript_excerpt: "left heading 280" },
        ],
      },
    ]);

    expect(findingPoints(finding)).toEqual([
      { id: 1, label: "1.1", text: "ATC assigned heading 270.", excerpt: "turn left heading 270" },
      { id: 2, label: "1.2", text: "Pilot read back heading 280.", excerpt: "left heading 280" },
    ]);
  });

  it("falls back to the legacy description and excerpt when detail_points is empty", () => {
    const [finding] = orderedFindings([
      {
        ...obs("phraseology_note", "medium", "Other"),
        description: "Legacy description.",
        transcript_excerpt: "legacy excerpt",
      },
    ]);

    expect(findingPoints(finding)).toEqual([
      { id: 1, label: "1", text: "Legacy description.", excerpt: "legacy excerpt" },
    ]);
  });
});

describe("attributedCallsigns", () => {
  it("returns distinct plausible finding callsigns (display form, first occurrence)", () => {
    const observations = [
      { ...obs("phraseology_note", "low", "A"), callsign: "UAL123" },
      { ...obs("situational_event", "high", "B"), callsign: "DAL456" },
      { ...obs("phraseology_note", "low", "C"), callsign: "UAL123" },
    ];
    expect(attributedCallsigns(observations)).toEqual(["UAL123", "DAL456"]);
  });

  it("ignores null and implausible (digit-fragment) callsigns", () => {
    const observations = [
      { ...obs("phraseology_note", "low", "A"), callsign: null },
      { ...obs("phraseology_note", "low", "B"), callsign: "273" },
    ];
    expect(attributedCallsigns(observations)).toEqual([]);
  });
});
