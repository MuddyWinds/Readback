import React from "react";
import { formatDistanceToNow } from "date-fns";
import { getCardSeverity } from "../../lib/severity";
import type { AnalysisResult, Filter } from "../../lib/types";
import { extractCallsign } from "../../lib/transcript";
import { CompliantCard } from "./CompliantCard";
import { UnassessableCard } from "./UnassessableCard";
import { ObservationCard } from "./ObservationCard";
import styles from "./LiveFeed.module.css";

export type {
  SpeakerSegment, Enrichment, ObservationKind, Observation,
  AnalysisResult, Severity, Filter, GroupBy,
} from "../../lib/types";
export { getCardSeverity, SEV_ORDER } from "../../lib/severity";

interface PipelineStatusSummary {
  queued_transcripts: number;
  next_batch_at: string | null;
  last_audio_at: string | null;
  last_gemini_error: string | null;
}

// ─── ResultCard — routes to the right component ──────────────────────────────
const ResultCard = React.memo(function ResultCard({ r, priorOccurrences, lastSeenAgo, onSelectAircraft, onOpenResultContext }: {
  r: AnalysisResult;
  priorOccurrences?: number;
  lastSeenAgo?: string | null;
  onSelectAircraft?: (sel: { icao24: string | null; callsign: string | null } | null) => void;
  onOpenResultContext?: (r: AnalysisResult, sel: { icao24: string | null; callsign: string | null } | null) => void;
}) {
  const severity = getCardSeverity(r);
  if (severity === "unassessable") return <UnassessableCard r={r} onOpenResultContext={onOpenResultContext} />;
  if (severity === "standard") return <CompliantCard r={r} onOpenResultContext={onOpenResultContext} />;
  return (
    <ObservationCard
      r={r}
      priorOccurrences={priorOccurrences}
      lastSeenAgo={lastSeenAgo}
      onSelectAircraft={onSelectAircraft}
      onOpenResultContext={onOpenResultContext}
    />
  );
});

// ─── LiveFeed ─────────────────────────────────────────────────────────────────
interface Props {
  results: AnalysisResult[];
  filter: Filter;
  airportFilter: string;
  noteTypeFilter?: string | null;
  isRunning?: boolean;
  pipelineStatus?: PipelineStatusSummary | null;
  apiError?: string | null;
  onSelectAircraft?: (sel: { icao24: string | null; callsign: string | null } | null) => void;
  onOpenResultContext?: (r: AnalysisResult, sel: { icao24: string | null; callsign: string | null } | null) => void;
}

function emptyMessage(
  results: AnalysisResult[],
  isRunning?: boolean,
  pipelineStatus?: PipelineStatusSummary | null,
  apiError?: string | null,
): string {
  if (apiError) return "Unable to load analysis cards. Check the pipeline status above.";
  if (results.length > 0) return "No results match this filter.";
  if (!isRunning) return "Start monitoring to collect ATC transcripts.";
  if (pipelineStatus?.last_gemini_error) return "Gemini is unavailable. Captured transcripts will appear as review cards after the batch fallback persists.";
  if ((pipelineStatus?.queued_transcripts ?? 0) > 0) return "Transcripts are queued and waiting for the next Gemini batch.";
  if (pipelineStatus?.last_audio_at) return "Audio is connected. Waiting for a readable ATC transmission.";
  return "Connecting to live ATC feeds...";
}

export function LiveFeed({
  results,
  filter,
  airportFilter,
  noteTypeFilter,
  isRunning,
  pipelineStatus,
  apiError,
  onSelectAircraft,
  onOpenResultContext,
}: Props) {
  // Build callsign occurrence index (results ordered newest-first)
  // For each result, compute how many OLDER results share the same callsign
  const callsignIndex = React.useMemo(() => {
    const index = new Map<string, number[]>(); // callsign → indices in results[]
    results.forEach((r, i) => {
      const cs = r.enrichment?.callsign_detected ?? extractCallsign(r.transcript).callsign;
      if (!cs) return;
      if (!index.has(cs)) index.set(cs, []);
      index.get(cs)!.push(i);
    });
    return index;
  }, [results]);

  const filtered = results.filter(r => {
    if (filter !== "all" && getCardSeverity(r) !== filter) return false;
    if (airportFilter !== "all" && r.airport_code !== airportFilter) return false;
    if (noteTypeFilter && !(r.observations ?? []).some(o => o.note_type === noteTypeFilter)) return false;
    return true;
  });

  return (
    <div>
      {filtered.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyMessage}>
            {emptyMessage(results, isRunning, pipelineStatus, apiError)}
          </div>
          {isRunning && results.length === 0 && (
            <div className={styles.emptyDetail}>
              The analyzer batches transcripts before creating cards, so live audio can lead visible results by several minutes.
            </div>
          )}
        </div>
      )}
      <div className={styles.cardList}>
        {filtered.map(r => {
          // Find global index in results[]
          const globalIdx = results.indexOf(r);
          const cs = r.enrichment?.callsign_detected ?? extractCallsign(r.transcript).callsign;
          let priorOccurrences = 0;
          let lastSeenAgo: string | null = null;
          if (cs) {
            const allIdx = callsignIndex.get(cs) ?? [];
            // Prior = older (higher index, since results sorted newest-first)
            const priorIdx = allIdx.filter(i => i > globalIdx);
            priorOccurrences = priorIdx.length;
            if (priorIdx.length > 0) {
              const prevR = results[priorIdx[0]];
              lastSeenAgo = formatDistanceToNow(
                new Date(prevR.timestamp.endsWith("Z") ? prevR.timestamp : prevR.timestamp + "Z"),
                { addSuffix: true }
              );
            }
          }
          return (
            <ResultCard
              key={r.id ?? `${r.airport_code}-${r.timestamp}`}
              r={r}
              priorOccurrences={priorOccurrences}
              lastSeenAgo={lastSeenAgo}
              onSelectAircraft={onSelectAircraft}
              onOpenResultContext={onOpenResultContext}
            />
          );
        })}
      </div>
    </div>
  );
}
