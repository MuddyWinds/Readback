import { describe, it, expect } from "vitest";
import { TABS, isTabKey, visibleTabs } from "./tabs";

describe("tab registry", () => {
  it("includes the existing live and settings tabs", () => {
    const keys = TABS.map(t => t.key);
    expect(keys).toContain("live");
    expect(keys).toContain("settings");
  });

  it("each tab has a key, desktop label, and mobile label", () => {
    for (const t of TABS) {
      expect(t.key).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.mobileLabel).toBeTruthy();
    }
  });

  it("isTabKey validates membership", () => {
    expect(isTabKey("live")).toBe(true);
    expect(isTabKey("nope")).toBe(false);
  });

  it("visibleTabs shows enabled tabs and hides flagged-off tabs", () => {
    const visible = visibleTabs().map(t => t.key);
    expect(visible).toContain("live");
    expect(visible).toContain("insights");
    expect(visible).toContain("review");
    expect(visible).toContain("settings");
    expect(visible).not.toContain("study");
  });
});
