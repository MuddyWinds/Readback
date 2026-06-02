import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import type { AnalysisResult } from "../../lib/types";
import { extractCallsign, tokenizeTranscript } from "../../lib/transcript";
import { StatusWorkflow } from "./StatusWorkflow";
import styles from "./UnassessableCard.module.css";

/** Render a raw transcript with callsigns and contact frequencies highlighted. */
function HighlightedTranscript({ text }: { text: string }) {
  const tokens = tokenizeTranscript(text);
  return (
    <>
      {tokens.map((t, i) =>
        t.type === "callsign" ? (
          <span key={i} className={styles.callsignHL}>{t.value}</span>
        ) : t.type === "freq" ? (
          <span key={i} className={styles.freqHL}>{t.value}</span>
        ) : (
          <React.Fragment key={i}>{t.value}</React.Fragment>
        ),
      )}
    </>
  );
}

interface Props {
  r: AnalysisResult;
  onOpenResultContext?: (
    r: AnalysisResult,
    sel: { icao24: string | null; callsign: string | null } | null,
  ) => void;
}

export function UnassessableCard({ r, onOpenResultContext }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { callsign } = extractCallsign(r.transcript);
  const ago = formatDistanceToNow(
    new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z"),
    { addSuffix: true }
  );
  const confPct = r.assessable_confidence != null
    ? Math.round(r.assessable_confidence * 100) : null;
  const handleClick = () => {
    onOpenResultContext?.(r, callsign ? { icao24: null, callsign } : null);
    setExpanded(v => !v);
  };

  return (
    <div
      id={r.id ? `result-${r.id}` : undefined}
      className={styles.card}
      onClick={handleClick}
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
              <span>Raw Transcript (for manual review)</span>
              {r.transcript && (
                <>
                  <span className={`${styles.legend} ${styles.legendCallsign}`}>● callsign</span>
                  <span className={`${styles.legend} ${styles.legendFreq}`}>● frequency</span>
                </>
              )}
            </div>
            <div className={styles.transcriptBlock}>
              {r.transcript
                ? <HighlightedTranscript text={r.transcript} />
                : "— no readable text recovered —"}
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
