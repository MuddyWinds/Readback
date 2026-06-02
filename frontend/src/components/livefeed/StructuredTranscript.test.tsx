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

  it("does not render the readback discrepancy block inside the transcript", () => {
    render(
      <StructuredTranscript
        enrichment={{
          speaker_segments: [
            { role: "ATC", text: "United 123 climb and maintain 8000", callsign: "UAL123" },
            { role: "PILOT", text: "climb and maintain 6000 United 123", callsign: "UAL123" },
          ],
          atc_instruction: "climb and maintain 8000",
          pilot_readback: "climb and maintain 6000",
          readback_correct: false,
          readback_discrepancy: "Pilot read back 6000 ft instead of 8000 ft",
          callsign_detected: "UAL123",
          callsign_clarity: 90,
        }}
        rawTranscript="ignored"
        borderColor="#000"
      />,
    );

    expect(screen.queryByText("READBACK DISCREPANCY DETECTED")).toBeNull();
    expect(screen.queryByText("Pilot read back 6000 ft instead of 8000 ft")).toBeNull();
  });

  it("lights two transcript marks that share the same active id", () => {
    const enrichment = {
      speaker_segments: [
        { role: "ATC", text: "United 123 climb and maintain 8000", callsign: "UAL123" },
        { role: "PILOT", text: "climb and maintain 6000 United 123", callsign: "UAL123" },
      ],
      atc_instruction: "climb and maintain 8000",
      pilot_readback: "climb and maintain 6000",
      readback_correct: false,
      readback_discrepancy: "Pilot read back 6000 ft instead of 8000 ft",
      callsign_detected: "UAL123",
      callsign_clarity: 90,
    };

    render(
      <StructuredTranscript
        enrichment={enrichment as any}
        rawTranscript="ignored"
        borderColor="#000"
        excerptMarks={[
          { n: 9, label: "ATC", excerpt: "climb and maintain 8000" },
          { n: 9, label: "PIL", excerpt: "climb and maintain 6000" },
        ]}
        activeMark={9}
      />,
    );

    const atc = screen.getByLabelText("Finding ATC reference");
    const pil = screen.getByLabelText("Finding PIL reference");
    expect(atc.className).toContain("markActive");
    expect(pil.className).toContain("markActive");
  });
});
