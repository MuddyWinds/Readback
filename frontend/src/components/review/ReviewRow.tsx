import type { AnalysisResult, Observation } from "../../lib/types";
import { ConfidenceBadge } from "../livefeed/ConfidenceBadge";
import { ReviewerNotes } from "../livefeed/ReviewerNotes";
import { SectionLabel } from "../livefeed/SectionLabel";
import { StatusWorkflow } from "../livefeed/StatusWorkflow";
import type { ReviewStatus } from "../livefeed/constants";
import styles from "./ReviewQueue.module.css";

function topSeverity(observations: Observation[] = []): string {
  const rank: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  return observations.reduce(
    (top, obs) => (rank[obs.significance] > rank[top] ? obs.significance : top),
    "standard",
  );
}

interface Props {
  row: AnalysisResult;
  selected: boolean;
  onChanged: (next: ReviewStatus) => void;
}

export function ReviewRow({ row, selected, onChanged }: Props) {
  const severity = topSeverity(row.observations);
  return (
    <article
      data-review-row={row.id}
      className={`${styles.row} ${selected ? styles.rowSelected : ""}`}
      aria-current={selected ? "true" : undefined}
    >
      <div className={styles.rowTop}>
        <div className={styles.rowMeta}>
          <span className={styles.airport}>{row.airport_code}</span>
          <span className={styles.severity} data-severity={severity}>{severity}</span>
          <ConfidenceBadge score={row.confidence_score} />
        </div>
        <StatusWorkflow resultId={row.id} initial={row.status} onChanged={onChanged} />
      </div>

      <div className={styles.summaryBlock}>
        <SectionLabel>Summary</SectionLabel>
        <p className={styles.summary}>{row.summary || "No summary."}</p>
      </div>

      <div className={styles.transcript}>{row.transcript}</div>

      <div data-review-notes={row.id}>
        <ReviewerNotes resultId={row.id} initial={row.reviewer_notes ?? ""} />
      </div>
    </article>
  );
}
