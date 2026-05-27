import type { AnalysisResult } from "../components/LiveFeed";
import { getCardSeverity } from "./severity";

function tsMs(r: AnalysisResult): number {
  return new Date(r.timestamp.endsWith("Z") ? r.timestamp : `${r.timestamp}Z`).getTime();
}

/** Whole-percent compliance over assessable results, or null when none. */
export function complianceRate(results: AnalysisResult[]): number | null {
  const assessable = results.filter(r => r.assessable !== false);
  if (assessable.length === 0) return null;
  const standard = assessable.filter(r => r.is_standard).length;
  return Math.round((standard / assessable.length) * 100);
}

export function hfacsCounts(results: AnalysisResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    for (const v of r.observations ?? []) {
      if (v.hfacs_level) counts[v.hfacs_level] = (counts[v.hfacs_level] ?? 0) + 1;
    }
  }
  return counts;
}

export interface HourlyBin {
  hour: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  standard: number;
}

/** 24 hourly bins (oldest to newest), unassessable excluded. */
export function hourlyActivity(results: AnalysisResult[], now: Date = new Date()): HourlyBin[] {
  const bins: HourlyBin[] = [];
  for (let h = 23; h >= 0; h--) {
    const t = new Date(now.getTime() - h * 3_600_000);
    bins.push({
      hour: `${String(t.getUTCHours()).padStart(2, "0")}:00`,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      standard: 0,
    });
  }
  for (const r of results) {
    const age = (now.getTime() - tsMs(r)) / 3_600_000;
    const idx = 23 - Math.floor(age);
    if (idx < 0 || idx > 23) continue;
    const sev = getCardSeverity(r);
    if (sev === "unassessable") continue;
    bins[idx][sev] += 1;
  }
  return bins;
}

export interface Spike {
  last30: number;
  prior30: number;
  ratio: number;
  isSpike: boolean;
}

/** Violation-weighted spike: last 30 min vs prior 30 min. */
export function detectSpike(results: AnalysisResult[], now: number = Date.now()): Spike {
  const inWindow = (r: AnalysisResult, minAge: number, maxAge: number) => {
    const age = (now - tsMs(r)) / 60000;
    const sev = getCardSeverity(r);
    return age >= minAge && age < maxAge && sev !== "standard" && sev !== "unassessable";
  };
  const last30 = results.filter(r => inWindow(r, 0, 30)).length;
  const prior30 = results.filter(r => inWindow(r, 30, 60)).length;
  const ratio = prior30 > 0 ? last30 / prior30 : (last30 >= 3 ? 3 : 0);
  return { last30, prior30, ratio, isSpike: ratio >= 2 && last30 >= 2 };
}

export function topNoteTypes(results: AnalysisResult[], limit = 8): [string, number][] {
  const counts: Record<string, number> = {};
  for (const r of results) {
    for (const v of r.observations ?? []) {
      if (v.note_type) counts[v.note_type] = (counts[v.note_type] ?? 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
}
