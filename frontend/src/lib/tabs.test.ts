import { describe, it, expect } from "vitest";
import { EXPORT_ENABLED, TABS, isTabKey, visibleTabs } from "./tabs";

describe("tab registry", () => {
  it("includes all registered tabs", () => {
    const keys = TABS.map(t => t.key);
    expect(keys).toEqual(["live", "insights", "review", "study", "settings"]);
  });

  it("each tab has a key, desktop label, and mobile label", () => {
    for (const t of TABS) {
      expect(t.key).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.mobileLabel).toBeTruthy();
    }
  });

  it("isTabKey validates registered tabs, including hidden ones", () => {
    expect(isTabKey("live")).toBe(true);
    expect(isTabKey("study")).toBe(true);
    expect(isTabKey("nope")).toBe(false);
  });

  it("visibleTabs hides study but keeps live, insights, review, settings", () => {
    expect(visibleTabs().map(t => t.key)).toEqual(["live", "insights", "review", "settings"]);
  });

  it("keeps dataset export disabled until explicitly enabled", () => {
    expect(EXPORT_ENABLED).toBe(false);
  });
});
