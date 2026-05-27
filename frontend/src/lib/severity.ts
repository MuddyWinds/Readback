import type { AnalysisResult } from "../components/LiveFeed";

export type Severity = "standard" | "low" | "medium" | "high" | "critical" | "unassessable";

export const SEV_ORDER: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export function getCardSeverity(r: AnalysisResult): Severity {
  if (r.assessable === false) return "unassessable";
  if (!r.observations || r.observations.length === 0) return "standard";
  let maxRank = 0, maxSev = "low";
  for (const v of r.observations) {
    const rank = SEV_ORDER[v.significance] ?? 0;
    if (rank > maxRank) {
      maxRank = rank;
      maxSev = v.significance;
    }
  }
  return maxSev as Severity;
}
