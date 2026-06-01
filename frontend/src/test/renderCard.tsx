import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import type { AnalysisResult, Observation, SpeakerSegment } from "../lib/types";

/** Minimal, typed AnalysisResult for card tests. Override any field per test. */
export function makeResult(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const observations: Observation[] = overrides.observations ?? [];
  const segments: SpeakerSegment[] = overrides.enrichment?.speaker_segments ?? [];
  return {
    id: 1,
    timestamp: "2026-06-01T00:00:00",
    airport_code: "KJFK",
    transcript: "United 123 cleared to land runway 31L",
    assessable: true,
    assessable_confidence: 0.8,
    is_standard: false,
    observations,
    summary: "- Readback omitted runway",
    confidence_score: 0.7,
    status: "new",
    enrichment: {
      speaker_segments: segments,
      atc_instruction: null,
      pilot_readback: null,
      readback_correct: null,
      readback_discrepancy: null,
      callsign_detected: "UAL123",
      callsign_clarity: 90,
    },
    ...overrides,
  };
}

/**
 * Intentionally minimal: the card-structure tests mock ObservationCard's three
 * data-bound children (HazardBanner / PositionSnapshot / ReportActions), so no
 * QueryClientProvider or SettingsProvider is needed here. If a future test
 * renders one of those children for real, wrap `ui` in the app providers in
 * THIS helper rather than per-test.
 */
export function renderCard(ui: ReactElement) {
  return render(ui);
}
