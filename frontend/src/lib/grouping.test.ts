import { describe, it, expect } from "vitest";
import { groupByCallsign, UNATTRIBUTED } from "./grouping";
import type { Enrichment, Observation } from "./types";

function obs(callsign: string | null | undefined, note = "Other"): Observation {
  return {
    kind: "phraseology_note", note_type: note, hfacs_level: "Unsafe Act",
    significance: "low", description: "d", callsign,
  };
}
function enr(segments: Enrichment["speaker_segments"]): Enrichment {
  return {
    speaker_segments: segments, atc_instruction: null, pilot_readback: null,
    readback_correct: null, readback_discrepancy: null,
    callsign_detected: null, callsign_clarity: 0,
  };
}

describe("groupByCallsign", () => {
  it("splits two aircraft into two groups ordered by first segment appearance", () => {
    const enrichment = enr([
      { role: "ATC", text: "United 12 left 270", callsign: "UAL12" },
      { role: "PILOT", text: "left 280 United 12", callsign: "UAL12" },
      { role: "ATC", text: "Delta 456 go around", callsign: "DAL456" },
    ]);
    const observations = [obs("DAL456", "Go-around Non-compliance"), obs("UAL12", "Read-back Error")];

    const groups = groupByCallsign(enrichment, observations, "");

    expect(groups.map(g => g.key)).toEqual(["UAL12", "DAL456"]);
    expect(groups[0].segments).toHaveLength(2);
    expect(groups[0].observations[0].note_type).toBe("Read-back Error");
    expect(groups[1].observations[0].note_type).toBe("Go-around Non-compliance");
  });

  it("normalizes callsign variants into one group", () => {
    const enrichment = enr([
      { role: "ATC", text: "a", callsign: "UAL 12" },
      { role: "PILOT", text: "b", callsign: "UAL012" },
    ]);
    const groups = groupByCallsign(enrichment, [], "");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("UAL12");
    expect(groups[0].segments).toHaveLength(2);
  });

  it("places null-callsign content in a trailing unattributed group", () => {
    const enrichment = enr([
      { role: "ATC", text: "United 12 climb", callsign: "UAL12" },
      { role: "ATC", text: "traffic alert all aircraft", callsign: null },
    ]);
    const groups = groupByCallsign(enrichment, [obs(null)], "");
    expect(groups[0].key).toBe("UAL12");
    expect(groups[groups.length - 1].key).toBe(UNATTRIBUTED);
    expect(groups[groups.length - 1].segments).toHaveLength(1);
    expect(groups[groups.length - 1].observations).toHaveLength(1);
  });

  it("falls back to a single regex-derived group for legacy rows (no callsign fields)", () => {
    const enrichment = enr([
      { role: "ATC", text: "Delta 456 cleared to land 31L" },
      { role: "PILOT", text: "cleared to land 31L Delta 456" },
    ]);
    const groups = groupByCallsign(enrichment, [obs(undefined)], "Delta 456 cleared to land 31L");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("DAL456");
    expect(groups[0].segments).toHaveLength(2);
    expect(groups[0].observations).toHaveLength(1);
  });

  it("prefers callsign_detected over the regex for legacy rows", () => {
    const enrichment = { ...enr([{ role: "ATC", text: "cleared to land" }]), callsign_detected: "UAL 12" };
    const groups = groupByCallsign(enrichment, [obs(undefined)], "no obvious callsign in this text");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("UAL12");          // from callsign_detected, normalized
    expect(groups[0].segments).toHaveLength(1);
    expect(groups[0].observations).toHaveLength(1);
  });
});
