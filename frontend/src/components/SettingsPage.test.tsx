import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SettingsPage } from "./SettingsPage";
import { DEFAULT_RUNTIME } from "../lib/settings";

afterEach(cleanup);

vi.mock("../SettingsContext", () => ({
  useSettings: () => ({
    settings: {
      gemini_api_key: "test-key",
      runtime: DEFAULT_RUNTIME,
      feeds: [],
    },
    reload: vi.fn(),
  }),
}));

describe("SettingsPage", () => {
  it("places the live Gemini model selector before the API key in the Gemini panel", () => {
    render(<SettingsPage />);

    const modelLabel = screen.getByText("Gemini model - live");
    const keyLabel = screen.getByText("Gemini API key");

    expect(
      modelLabel.compareDocumentPosition(keyLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
