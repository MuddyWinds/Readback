import { describe, it, expect } from "vitest";
import { orderedFindings, attributedCallsigns } from "./findings";
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
