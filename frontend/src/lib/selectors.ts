import type { AnalysisResult, Filter } from "./types";
import { getCardSeverity } from "./severity";

export type { Filter } from "./types"; // re-export so `import { Filter } from "./selectors"` still resolves

export function severityCounts(
  results: AnalysisResult[],
  airportFilter: string,
): Record<Filter, number> {
  const counts: Record<Filter, number> = {
    all: 0,
    standard: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
    unassessable: 0,
  };
  const scoped = airportFilter === "all"
    ? results
    : results.filter(r => r.airport_code === airportFilter);
  for (const r of scoped) {
    counts.all++;
    counts[getCardSeverity(r)]++;
  }
  return counts;
}
