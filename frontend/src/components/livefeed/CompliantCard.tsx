import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { AnalysisResult } from "../../lib/types";
import { extractCallsign, extractActions } from "../../lib/transcript";
import { ACTION_TOKEN } from "./constants";
import { SectionLabel } from "./SectionLabel";
import { StructuredTranscript } from "./StructuredTranscript";
import { StatusWorkflow } from "./StatusWorkflow";
import { ReviewerNotes } from "./ReviewerNotes";
import styles from "./CompliantCard.module.css";

export function CompliantCard({ r }: { r: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false);
  const { callsign } = extractCallsign(r.transcript);
  const actions = extractActions(r.transcript);

  return (
    <div
      id={r.id ? `result-${r.id}` : undefined}
      className={styles.card}
      onClick={() => setExpanded(v => !v)}
    >
      {/* Single-line header — all info in one row */}
      <div className={styles.header}>
        <span className={styles.badge}>STANDARD</span>
        <span className={styles.airportCode}>{r.airport_code}</span>
        {callsign && (
          <span className={styles.callsign}>{callsign}</span>
        )}
        {actions.map(a => (
          <span
            key={a}
            className={styles.actionChip}
            style={{ ["--accent" as any]: `var(${ACTION_TOKEN[a] ?? "--text-dim"})` }}
          >
            {a}
          </span>
        ))}
        {/* Spacer */}
        <span className={styles.spacer} />
        <span className={styles.timestamp}>
          {formatDistanceToNow(new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z"), { addSuffix: true })}
        </span>
        <span className={styles.chevron}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded: analysis, structured transcript, investigation */}
      {expanded && (
        <div
          className={styles.expandedBody}
          onClick={e => e.stopPropagation()}
        >
          {/* Analysis */}
          {r.summary && (
            <div className={styles.section}>
              <SectionLabel>Analysis</SectionLabel>
              <p className={styles.summary}>{r.summary}</p>
            </div>
          )}

          {/* Structured transcript */}
          <div className={styles.section}>
            <SectionLabel>Transcript</SectionLabel>
            <StructuredTranscript
              enrichment={r.enrichment}
              rawTranscript={r.transcript}
              borderColor="var(--sev-standard-border)"
              assessableConfidence={r.assessable_confidence}
            />
          </div>

          {/* Review */}
          <div className={styles.review}>
            <StatusWorkflow resultId={r.id} initial={r.status} />
            <ReviewerNotes resultId={r.id} initial={r.reviewer_notes} />
          </div>
        </div>
      )}
    </div>
  );
}
