import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { StructuredTranscript } from "./StructuredTranscript";

afterEach(cleanup);

describe("StructuredTranscript excerpt highlights", () => {
  it("renders a numbered mark in the raw transcript path", () => {
    render(
      <StructuredTranscript
        enrichment={null}
        rawTranscript="Cathay 250 descend flight level 100"
        borderColor="#000"
        excerptMarks={[{ n: 1, excerpt: "descend flight level 100" }]}
      />,
    );
    const mark = screen.getByLabelText("Finding 1 reference");
    expect(mark.textContent).toContain("descend flight level 100");
  });

  it("renders a numbered mark inside a structured segment", () => {
    const enrichment = {
      speaker_segments: [
        { role: "ATC", text: "Cathay 250 descend flight level 100", callsign: "CPA250" },
      ],
      atc_instruction: null, pilot_readback: null, readback_correct: null,
      readback_discrepancy: null, callsign_detected: "CPA250", callsign_clarity: 90,
    };
    render(
      <StructuredTranscript
        enrichment={enrichment as any}
        rawTranscript="ignored"
        borderColor="#000"
        excerptMarks={[{ n: 1, excerpt: "flight level 100" }]}
      />,
    );
    expect(screen.getByLabelText("Finding 1 reference").textContent).toContain("flight level 100");
  });

  it("calls onMarkHover on mouse enter/leave and focus/blur", () => {
    const onMarkHover = vi.fn();
    render(
      <StructuredTranscript
        enrichment={null}
        rawTranscript="cleared to land"
        borderColor="#000"
        excerptMarks={[{ n: 3, excerpt: "cleared to land" }]}
        onMarkHover={onMarkHover}
      />,
    );
    const mark = screen.getByLabelText("Finding 3 reference");
    fireEvent.mouseEnter(mark);
    expect(onMarkHover).toHaveBeenCalledWith(3);
    fireEvent.mouseLeave(mark);
    expect(onMarkHover).toHaveBeenCalledWith(null);
    fireEvent.focus(mark);
    expect(onMarkHover).toHaveBeenCalledWith(3);
    fireEvent.blur(mark);
    expect(onMarkHover).toHaveBeenLastCalledWith(null);
  });
});
