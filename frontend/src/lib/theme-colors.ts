/**
 * Resolve a theme.css custom property (e.g. "--sev-high") to its computed value
 * at runtime. For color sites that cannot use var(): Recharts fill/stroke props
 * (rendered as SVG attributes) and Leaflet option objects (plain JS). theme.css
 * stays the single source of truth; this module holds token names, not hex.
 */
export function cssVar(name: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
