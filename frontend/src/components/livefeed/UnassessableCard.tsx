import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { AnalysisResult } from "../../lib/types";
import { StatusWorkflow } from "./StatusWorkflow";
import styles from "./UnassessableCard.module.css";

export function UnassessableCard({ r }: { r: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false);
  const ago = formatDistanceToNow(
    new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z"),
    { addSuffix: true }
  );
  const confPct = r.assessable_confidence != null
    ? Math.round(r.assessable_confidence * 100) : null;

  return (
    <div
      id={r.id ? `result-${r.id}` : undefined}
      className={styles.card}
      onClick={() => setExpanded(v => !v)}
    >
      {/* Collapsed header — mirrors CompliantCard structure */}
      <div className={styles.header}>
        <span className={styles.badge}>UNASSESSABLE</span>
        <span className={styles.airportCode}>{r.airport_code}</span>
        <span className={styles.spacer} />
        {confPct !== null && (
          <span className={styles.confBadge}>STT {confPct}%</span>
        )}
        <span className={styles.timestamp}>{ago}</span>
        <span className={styles.chevron}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded: full reason + transcript for spot-checking */}
      {expanded && (
        <div
          className={styles.expandedBody}
          onClick={e => e.stopPropagation()}
        >
          {/* Full reason paragraph */}
          {r.summary && (
            <div className={styles.reasonSection}>
              <div className={styles.reasonLabel}>Reason</div>
              <p className={styles.reasonText}>{r.summary}</p>
            </div>
          )}

          <div className={styles.transcriptSection}>
            <div className={styles.transcriptLabel}>
              Raw Transcript (for manual review)
            </div>
            <div className={styles.transcriptBlock}>
              {r.transcript || "— no readable text recovered —"}
            </div>
          </div>
          <div className={styles.exclusionNote}>
            <p className={styles.exclusionText}>
              This transmission was excluded from phraseology rate calculations.
            </p>
          </div>
          <div className={styles.review}>
            <StatusWorkflow resultId={r.id} initial={r.status} />
          </div>
        </div>
      )}
    </div>
  );
}
