import React from "react";
import styles from "./ConfidenceBadge.module.css";

/** Semantic confidence label — replaces bare "AI 73%" with meaningful tier. */
export function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tierClass =
    pct >= 75 ? styles.reliable :
    pct >= 50 ? styles.verify :
                styles.unreliable;
  const label =
    pct >= 75 ? "RELIABLE" :
    pct >= 50 ? "VERIFY" :
                "UNRELIABLE";
  return (
    <span
      title={`AI confidence: ${pct}% — ${
        pct >= 75 ? "verdict is well-supported" :
        pct >= 50 ? "manually verify this transcript before acting" :
                    "low confidence — treat as indicative only"
      }`}
      className={`${styles.badge} ${tierClass}`}
    >
      {pct >= 75 ? "" : "⚠ "}{label} {pct}%
    </span>
  );
}
