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
    // NOTE: keep a "high" severity here — it makes posDefault true so showPosition
    // starts on and the position-snapshot assertions below render.
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

describe("ObservationCard layout (flat numbered findings)", () => {
  it("renders the transcript exactly once, in the Evidence zone", () => {
    renderCard(<ObservationCard r={twoAircraftResult()} />);
    expect(screen.getAllByTestId("evidence-transcript")).toHaveLength(1);
  });

  it("renders one position per attributed callsign for a multi-aircraft card", () => {
    renderCard(<ObservationCard r={twoAircraftResult()} />);
    expect(screen.getAllByTestId("position-snapshot")).toHaveLength(2);
  });

  it("numbers every finding and never shows the old unattributed heading", () => {
    renderCard(<ObservationCard r={twoAircraftResult()} />);
    const badges = screen.getAllByTestId("finding-number");
    expect(badges.map(b => b.textContent)).toEqual(["1", "2"]);
    expect(screen.queryByText(/General \/ unattributed/i)).toBeNull();
  });

  it("shows per-finding callsign chips on a multi-aircraft card", () => {
    renderCard(<ObservationCard r={twoAircraftResult()} />);
    expect(screen.getAllByText("UAL123").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("DAL456").length).toBeGreaterThanOrEqual(1);
  });

  it("treats two segment callsigns + one attributed finding as single-aircraft (regression)", () => {
    const r = makeResult({
      observations: [
        { kind: "phraseology_note", note_type: "Read-back Error", hfacs_level: "Unsafe Act",
          significance: "high", description: "n1", safety_pathway: null,
          relevant_regulation: null, transcript_excerpt: null, callsign: "UAL123" },
      ],
      enrichment: {
        speaker_segments: [
          { role: "ATC", text: "United 123 cleared to land 31L", callsign: "UAL123" },
          { role: "ATC", text: "Delta 456 line up and wait 31L", callsign: "DAL456" },
        ],
        atc_instruction: null, pilot_readback: null, readback_correct: null,
        readback_discrepancy: null, callsign_detected: "UAL123", callsign_clarity: 90,
      },
    });
    renderCard(<ObservationCard r={r} />);
    expect(screen.getAllByTestId("position-snapshot")).toHaveLength(1);
    expect(screen.getAllByTestId("finding-number")).toHaveLength(1);
  });
});

describe("ObservationCard STT chip", () => {
  it("surfaces assessable_confidence as a distinct STT % chip (not AI confidence)", () => {
    renderCard(<ObservationCard r={makeResult({ assessable_confidence: 0.42 })} />);
    const chip = screen.getByTestId("stt-confidence");
    expect(chip.textContent).toContain("STT 42%");
  });

  it("omits the STT chip when assessable_confidence is absent", () => {
    // override the fixture's baseline 0.8 to exercise the absent (chip-omitted) branch
    renderCard(<ObservationCard r={makeResult({ assessable_confidence: undefined })} />);
    expect(screen.queryByTestId("stt-confidence")).toBeNull();
  });
});

describe("ObservationCard preserved behavior", () => {
  it("keeps What-happened bullets, review guidance, and the callsign", () => {
    renderCard(<ObservationCard r={makeResult({ summary: "- Readback omitted runway" })} />);
    // Throwing getters are the assertion; getByText throws if the text is absent.
    screen.getByText("Readback omitted runway");
    screen.getByText(/Review Guidance/i);
    // Single-aircraft cards show the callsign in the header only (no analysis heading,
    // no per-finding chip), and the default fixture has no observations.
    expect(screen.getAllByText("UAL123")).toHaveLength(1);
  });

  it("renders the watchlist toggle for the primary callsign", () => {
    renderCard(<ObservationCard r={makeResult()} />);
    // getByTitle throws if the star button's title is missing.
    screen.getByTitle(/watch this callsign/i);
  });

  it("shows the prior-occurrence alert when priorOccurrences > 0", () => {
    renderCard(<ObservationCard r={makeResult()} priorOccurrences={2} lastSeenAgo="5 minutes ago" />);
    // priorOccurrences=2 → renders "3th occurrence this session"; pin the count math.
    expect(screen.getByText(/3th occurrence this session/i)).toBeTruthy();
  });
});
