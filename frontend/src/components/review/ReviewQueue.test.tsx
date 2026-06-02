import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const mutateAsync = vi.fn().mockResolvedValue({ ok: true });
const ROWS = [
  {
    id: 1,
    airport_code: "KSFO",
    transcript: "ROW-ONE",
    summary: "s1",
    status: "new",
    assessable: true,
    is_standard: false,
    observations: [],
    confidence_score: 0.9,
    timestamp: "2026-06-01T12:00:00",
    reviewer_notes: null,
    enrichment: null,
  },
  {
    id: 2,
    airport_code: "KSFO",
    transcript: "ROW-TWO",
    summary: "s2",
    status: "new",
    assessable: true,
    is_standard: false,
    observations: [],
    confidence_score: 0.9,
    timestamp: "2026-06-01T12:01:00",
    reviewer_notes: null,
    enrichment: null,
  },
];

vi.mock("../../lib/queries", () => ({
  useReviewQueue: () => ({ data: ROWS, isLoading: false, error: null }),
  useUpdateResult: () => ({ mutateAsync }),
}));

import { ReviewQueue } from "./ReviewQueue";

describe("ReviewQueue keyboard triage", () => {
  it("c confirms the selected row, then advances so the next c targets row 2", async () => {
    mutateAsync.mockClear();
    render(<ReviewQueue />);

    fireEvent.keyDown(window, { key: "c" });
    await Promise.resolve();
    fireEvent.keyDown(window, { key: "c" });

    expect(mutateAsync).toHaveBeenNthCalledWith(1, { id: 1, patch: { status: "confirmed" } });
    expect(mutateAsync).toHaveBeenNthCalledWith(2, { id: 2, patch: { status: "confirmed" } });
  });

  it("j moves selection to the next row before acting", () => {
    mutateAsync.mockClear();
    render(<ReviewQueue />);

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "x" });

    expect(mutateAsync).toHaveBeenCalledWith({ id: 2, patch: { status: "false_positive" } });
  });
});
