import React from "react";
import { formatDistanceToNow } from "date-fns";
import { getCardSeverity } from "../../lib/severity";
import type { AnalysisResult, Enrichment, Observation, Severity, Filter } from "../../lib/types";
import { extractCallsign } from "../../lib/transcript";
import { CompliantCard } from "./CompliantCard";
import { UnassessableCard } from "./UnassessableCard";
import { ObservationCard } from "./ObservationCard";

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
const ResultCard = React.memo(function ResultCard({ r, priorOccurrences, lastSeenAgo }: {
  r: AnalysisResult;
  priorOccurrences?: number;
  lastSeenAgo?: string | null;
}) {
  const severity = getCardSeverity(r);
  if (severity === "unassessable") return <UnassessableCard r={r} />;
  if (severity === "standard") return <CompliantCard r={r} />;
  return <ObservationCard r={r} priorOccurrences={priorOccurrences} lastSeenAgo={lastSeenAgo} />;
});

// ─── LiveFeed ─────────────────────────────────────────────────────────────────
interface Props {
  results: AnalysisResult[];
  filter: Filter;
  airportFilter: string;
  isRunning?: boolean;
  pipelineStatus?: PipelineStatusSummary | null;
  apiError?: string | null;
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

export function LiveFeed({ results, filter, airportFilter, isRunning, pipelineStatus, apiError }: Props) {
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
    return true;
  });

  return (
    <div>
      {filtered.length === 0 && (
        <div style={{
          color: "#8b949e",
          textAlign: "center" as const,
          margin: "40px auto",
          maxWidth: 460,
          border: "1px dashed #30363d",
          borderRadius: 8,
          padding: "22px 20px",
          background: "#0d1117",
        }}>
          <div style={{ fontSize: 14, color: "#c9d1d9", marginBottom: 6 }}>
            {emptyMessage(results, isRunning, pipelineStatus, apiError)}
          </div>
          {isRunning && results.length === 0 && (
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              The analyzer batches transcripts before creating cards, so live audio can lead visible results by several minutes.
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((r, filteredIdx) => {
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
            />
          );
        })}
      </div>
    </div>
  );
}
