import { AnalysisResult } from "../components/LiveFeed";
import { DateFilter, getStartDate, parseTs } from "./format";

const RESULTS_CAP = 500;

/**
 * Compute the next results array for an incoming analysis WS message.
 *
 * React Query passes undefined to setQueryData updaters before the initial
 * query has populated a key, so the previous cache value is coalesced to [].
 */
export function applyAnalysis(
  prev: AnalysisResult[] | undefined,
  msg: { data: AnalysisResult },
  dateFilter: DateFilter,
): AnalysisResult[] {
  const base = prev ?? [];
  const startDate = getStartDate(dateFilter);
  if (startDate && parseTs(msg.data.timestamp) < new Date(startDate)) return base;
  return [msg.data, ...base].slice(0, RESULTS_CAP);
}
