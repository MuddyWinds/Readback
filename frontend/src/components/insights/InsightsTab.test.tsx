import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InsightsTab } from "./InsightsTab";

const EMPTY_STATS = {
  total_chunks_analyzed: 0, assessable_chunks: 0, unassessable_chunks: 0,
  non_standard_chunks: 0, conformance_rate: null,
  severity_breakdown: { critical: 0, high: 0, medium: 0, low: 0 },
  hfacs_breakdown: {}, airport_conformance: {}, airport_risk_matrix: {}, note_type_details: {},
};

describe("InsightsTab", () => {
  it("renders zero-state when there is no data", () => {
    render(<InsightsTab stats={EMPTY_STATS} results={[]} onNavigate={() => {}} />);
    expect(screen.queryByText(/no analyses/i)).not.toBeNull();
  });

  it("renders headline numbers when populated", () => {
    render(<InsightsTab stats={{ ...EMPTY_STATS, total_chunks_analyzed: 42 }} results={[]} onNavigate={() => {}} />);
    expect(screen.queryByText("42")).not.toBeNull();
  });
});
