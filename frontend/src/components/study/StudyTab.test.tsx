import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

let callsigns = [
  { callsign: "AAL123", count: 2 },
  { callsign: "UAL5", count: 1 },
];
const useStudySheet = vi.fn((cs: string | null) => ({
  data: cs ? { callsign: cs, transmission_count: 2, study_sheet: `SHEET-FOR-${cs}` } : undefined,
  isLoading: false,
  error: null,
}));

vi.mock("../../lib/queries", () => ({
  useCallsigns: () => ({ data: callsigns, isLoading: false, error: null }),
  useStudySheet: (cs: string | null) => useStudySheet(cs),
}));

import { StudyTab } from "./StudyTab";

describe("StudyTab", () => {
  beforeEach(() => {
    callsigns = [
      { callsign: "AAL123", count: 2 },
      { callsign: "UAL5", count: 1 },
    ];
    useStudySheet.mockClear();
  });

  it("lists callsigns and renders the sheet for the selected one", () => {
    render(<StudyTab />);

    expect(screen.queryByText("AAL123")).not.toBeNull();
    expect(screen.queryByText("UAL5")).not.toBeNull();

    fireEvent.click(screen.getByText("AAL123"));

    expect(screen.queryByText(/SHEET-FOR-AAL123/)).not.toBeNull();
  });

  it("shows empty copy when there are no callsigns", () => {
    callsigns = [];

    render(<StudyTab />);

    expect(screen.queryByText(/no callsigns/i)).not.toBeNull();
  });
});
