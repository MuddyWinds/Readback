import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import { ObservationCard } from "./ObservationCard";
import { makeResult, renderCard } from "../../test/renderCard";
import type { Observation, SpeakerSegment } from "../../lib/types";

// globals: false in vitest config means Testing Library's auto-cleanup hook
// (which checks `typeof afterEach === "function"`) doesn't fire.
// We register it explicitly so each test starts with a clean DOM.
afterEach(cleanup);

// ObservationCard's three data-bound children each need app providers
// (React Query / SettingsContext) and would touch the network. They are
// covered by their own units + Task 5's manual pass; here we mock them so the
// card-structure tests run provider-free and deterministic. Stubbing to null
// is enough — the `position-snapshot` test id is on ObservationCard's OWN
// wrapper div, so the per-group position assertion still tests real card logic.
vi.mock("./HazardBanner", () => ({ HazardBanner: () => null }));
vi.mock("./PositionSnapshot", () => ({ PositionSnapshot: () => null }));
vi.mock("./ReportActions", () => ({ ReportActions: () => null }));

function twoAircraftResult() {
  const segments: SpeakerSegment[] = [
    { role: "ATC", text: "United 123 cleared to land 31L", callsign: "UAL123" },
    { role: "PILOT", text: "Cleared to land 31L, United 123", callsign: "UAL123" },
    { role: "ATC", text: "Delta 456 line up and wait 31L", callsign: "DAL456" },
  ];
  const observations: Observation[] = [
    { kind: "phraseology_note", note_type: "Read-back Error", hfacs_level: "Unsafe Act",
      significance: "medium", description: "n1", safety_pathway: null,
      relevant_regulation: null, transcript_excerpt: null, callsign: "UAL123" },
    { kind: "situational_event", note_type: "Other", hfacs_level: "Unsafe Act",
      significance: "high", description: "e1", safety_pathway: null,
      relevant_regulation: null, transcript_excerpt: null, callsign: "DAL456" },
  ];
  return makeResult({
    observations,
    enrichment: {
      speaker_segments: segments, atc_instruction: null, pilot_readback: null,
      readback_correct: null, readback_discrepancy: null,
      callsign_detected: "UAL123", callsign_clarity: 90,
    },
  });
}

describe("ObservationCard layout (Approach A)", () => {
  it("renders the transcript exactly once, in the Evidence zone", () => {
    renderCard(<ObservationCard r={twoAircraftResult()} />);
    expect(screen.getAllByTestId("evidence-transcript")).toHaveLength(1);
  });

  it("renders one Analysis group per attributed callsign, each with its own position", () => {
    renderCard(<ObservationCard r={twoAircraftResult()} />);
    expect(screen.getAllByTestId("analysis-group")).toHaveLength(2);
    expect(screen.getAllByTestId("position-snapshot")).toHaveLength(2);
  });

  it("does NOT render a transcript inside Analysis groups", () => {
    renderCard(<ObservationCard r={twoAircraftResult()} />);
    const groups = screen.getAllByTestId("analysis-group");
    for (const g of groups) {
      expect(g.querySelectorAll('[data-testid="evidence-transcript"]')).toHaveLength(0);
    }
  });
});
