import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import { UnassessableCard } from "./UnassessableCard";
import { makeResult, renderCard } from "../../test/renderCard";

afterEach(cleanup);

// StatusWorkflow is data-bound (network + providers); stub it for a
// provider-free render of the card's own structure.
vi.mock("./StatusWorkflow", () => ({ StatusWorkflow: () => null }));

function expandCard() {
  // Card body is revealed on click of the collapsed header row.
  fireEvent.click(screen.getByText("UNASSESSABLE"));
}

describe("UnassessableCard highlighting", () => {
  it("wraps callsigns and contact frequencies in highlight spans", () => {
    renderCard(<UnassessableCard r={makeResult({
      assessable: false,
      transcript: "Good day. 118.925. Hong Kong shuttle 646.",
      summary: "Low transcription confidence",
    })} />);
    expandCard();

    // Highlighted tokens render as <span>; surrounding prose stays plain text.
    expect(screen.getByText("118.925").tagName).toBe("SPAN");
    expect(screen.getByText("shuttle 646").tagName).toBe("SPAN");
  });

  it("renders plain transcript when there is nothing to highlight", () => {
    renderCard(<UnassessableCard r={makeResult({
      assessable: false,
      transcript: "static and unintelligible chatter",
      summary: "Audio too degraded",
    })} />);
    expandCard();

    // The whole transcript is one plain text node — no highlight spans.
    expect(screen.getByText("static and unintelligible chatter")).toBeTruthy();
  });
});
