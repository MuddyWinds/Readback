export type TabKey = "live" | "settings" | "insights" | "review" | "study";

export interface TabDef {
  key: TabKey;
  label: string;        // desktop
  mobileLabel: string;  // compact
  /** When false the tab is registered but hidden from the bar (feature-flag style). */
  enabled?: boolean;
}

// Order here is render order in the tab bar. New surfaces start disabled and flip
// their own flag to true as the final step of their feature.
export const TABS: TabDef[] = [
  { key: "live",     label: "Live Feed", mobileLabel: "Feed" },
  { key: "insights", label: "Insights",  mobileLabel: "Stats" },
  { key: "review",   label: "Review",    mobileLabel: "Review" },
  { key: "study",    label: "Study",     mobileLabel: "Study" },
  { key: "settings", label: "Settings",  mobileLabel: "Setup" },
];

const KEYS = new Set<string>(TABS.map(t => t.key));

export function isTabKey(s: string): s is TabKey {
  return KEYS.has(s);
}

/** Tabs to render in the bar (enabled !== false). */
export function visibleTabs(): TabDef[] {
  return TABS.filter(t => t.enabled !== false);
}
