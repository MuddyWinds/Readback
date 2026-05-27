/**
 * Truncate a regulation citation to chapter level for display.
 * Cuts at "Section", "Para", "§", or sub-section numbers (e.g. "8.3.1").
 * The comma before the divider is optional.
 * Full string always available on hover via title attribute.
 */
export function truncateAtChapter(reg: string): string {
  const cut = reg.search(/,?\s*(Section|Para(graph)?|§|\d+\.\d+\.\d+)\b/i);
  return cut > 0 ? reg.slice(0, cut).trim() : reg;
}

/** Extract the base document name — everything before the first comma. */
export function toDocName(reg: string): string {
  const i = reg.indexOf(",");
  return i > 0 ? reg.slice(0, i).trim() : reg.trim();
}
