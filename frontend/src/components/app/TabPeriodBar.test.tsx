import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Inject a custom tab list so the test fails unless the bar renders FROM the registry.
vi.mock("../../lib/tabs", () => ({
  visibleTabs: () => [
    { key: "live", label: "Live Feed", mobileLabel: "Feed" },
    { key: "settings", label: "Settings", mobileLabel: "Setup" },
  ],
}));

import { TabPeriodBar } from "./TabPeriodBar";

describe("TabPeriodBar", () => {
  it("renders a button for every tab the registry exposes and fires onTab", () => {
    const onTab = vi.fn();
    render(
      <TabPeriodBar tab="live" onTab={onTab} dateFilter="all" onDateFilter={() => {}} isMobile={false} />
    );
    // "Settings" only renders if the bar is registry-driven — hard-coded code never shows it.
    const settings = screen.getByRole("button", { name: "Settings" });
    expect(screen.getByRole("button", { name: "Live Feed" })).toBeTruthy();
    fireEvent.click(settings);
    expect(onTab).toHaveBeenCalledWith("settings");
  });
});
