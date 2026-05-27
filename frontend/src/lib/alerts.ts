import type { AnalysisResult, Severity, Filter } from "./types";
import { getCardSeverity, SEV_ORDER } from "./severity";

export type AlertFloor = "low" | "medium" | "high" | "critical";

/**
 * Does a card of `severity` meet the alert `floor`? Uses the shared SEV_ORDER
 * ranking. "standard"/"unassessable" have no rank (→ 0) so never alert.
 */
export function shouldAlert(severity: Severity, floor: AlertFloor): boolean {
  return (SEV_ORDER[severity] ?? 0) >= (SEV_ORDER[floor] ?? Infinity);
}

export interface NavTarget {
  airportFilter: string;
  severityFilter: Filter;
  sidebarAirport: string;
  resultId?: number;
}

/**
 * Where a toast click should take the user. Relaxes the active severity filter
 * to "all" only when it would otherwise hide the target card.
 */
export function resolveNavTarget(result: AnalysisResult, currentSeverityFilter: Filter): NavTarget {
  const sev = getCardSeverity(result);
  const severityFilter: Filter =
    currentSeverityFilter === "all" || currentSeverityFilter === sev
      ? currentSeverityFilter
      : "all";
  return {
    airportFilter: result.airport_code,
    severityFilter,
    sidebarAirport: result.airport_code,
    resultId: result.id,
  };
}
