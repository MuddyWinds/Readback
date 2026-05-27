import React, { useState } from "react";
import type { AnalysisResult } from "../../lib/types";
import { buildReportText } from "../../lib/report";
import { StatusWorkflow } from "./StatusWorkflow";
import { ReviewerNotes } from "./ReviewerNotes";
import styles from "./ReportActions.module.css";

interface Props {
  r: AnalysisResult;
  callsign: string | null;
}

export function ReportActions({ r, callsign }: Props) {
  const [reportCopied, setReportCopied] = useState(false);

  return (
    <div className={styles.container}>
      <StatusWorkflow resultId={r.id} initial={r.status} />
      <ReviewerNotes resultId={r.id} initial={r.reviewer_notes} />
      <div className={styles.copyRow}>
        <button
          className={styles.copyBtn}
          onClick={() => {
            const text = buildReportText(r, callsign);
            navigator.clipboard.writeText(text).then(() => {
              setReportCopied(true);
              setTimeout(() => setReportCopied(false), 2500);
            });
          }}
        >
          <span>{reportCopied ? "✓" : "⎘"}</span>
          {reportCopied ? "Copied to clipboard" : "Copy study sheet"}
        </button>
        <span className={styles.pasteNote}>Paste into your review system</span>
      </div>
    </div>
  );
}
