export type DateFilter = "today" | "7d" | "30d" | "ytd" | "all";

export function getStartDate(f: DateFilter): string | null {
  const now = new Date();
  if (f === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0); return d.toISOString();
  }
  if (f === "7d") return new Date(now.getTime() - 7 * 86400000).toISOString();
  if (f === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
  if (f === "ytd") return new Date(now.getFullYear(), 0, 1).toISOString();
  return null;
}

export function parseTs(ts: string): Date {
  return new Date(ts.endsWith("Z") ? ts : ts + "Z");
}
