import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LiveFeed } from "./LiveFeed";
import type { AnalysisResult } from "../../lib/types";

// Mirror ObservationCard.test.tsx: mock data-bound children that need QueryClient/SettingsContext
vi.mock("./HazardBanner", () => ({ HazardBanner: () => null }));
vi.mock("./PositionSnapshot", () => ({ PositionSnapshot: () => null }));
vi.mock("./ReportActions", () => ({ ReportActions: () => null }));

afterEach(cleanup);

function makeResult(id: number, callsign: string, noteType: string): AnalysisResult {
  return {
    id,
    timestamp: "2026-06-01T12:00:00",
    airport_code: "KSFO",
    transcript: `${callsign} test transmission`,
    assessable: true,
    assessable_confidence: 1,
    is_standard: false,
    observations: [{
      kind: "phraseology_note",
      note_type: noteType,
      hfacs_level: "Unsafe Act",
      significance: "medium",
      description: "d",
      callsign,
    }],
    summary: "summary text here",
    confidence_score: 0.9,
    status: "new",
    enrichment: null,
  };
}

describe("LiveFeed note-type filter", () => {
  it("removes cards lacking the active note type from the DOM", () => {
    const readback = makeResult(1, "AAL123", "Read-back Error");
    const freq = makeResult(2, "UAL5", "Frequency/Channel Error");
    render(
      <LiveFeed
        results={[readback, freq]}
        filter="all"
        airportFilter="all"
        noteTypeFilter="Read-back Error"
        isRunning
        pipelineStatus={null}
        apiError={null}
        onSelectAircraft={() => {}}
      />
    );
    expect(screen.queryByText("AAL123")).not.toBeNull(); // kept
    expect(screen.queryByText("UAL5")).toBeNull();       // filtered out
  });

  it("shows all cards when noteTypeFilter is null", () => {
    const readback = makeResult(1, "AAL123", "Read-back Error");
    const freq = makeResult(2, "UAL5", "Frequency/Channel Error");
    render(
      <LiveFeed
        results={[readback, freq]}
        filter="all"
        airportFilter="all"
        noteTypeFilter={null}
        isRunning
        pipelineStatus={null}
        apiError={null}
        onSelectAircraft={() => {}}
      />
    );
    expect(screen.queryByText("AAL123")).not.toBeNull();
    expect(screen.queryByText("UAL5")).not.toBeNull();
  });
});
