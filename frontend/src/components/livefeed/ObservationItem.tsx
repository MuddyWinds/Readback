import React from "react";
import type { Observation } from "../../lib/types";
import { HFACS_PLAIN } from "./constants";
import { RegBadge } from "./RegBadge";
import styles from "./ObservationItem.module.css";

interface Props {
  observation: Observation;
  index: number;
  isLast: boolean;
}

export function ObservationItem({ observation: v, index: i, isLast }: Props) {
  const vLabelColor = ["medium", "low"].includes(v.significance) ? "var(--bg)" : "white";
  const hfacsPlain = HFACS_PLAIN[v.hfacs_level] ?? v.hfacs_level;
  const accentVar = `var(--sev-${v.significance})`;

  return (
    <div
      className={isLast ? styles.rowLast : styles.row}
      style={{ ["--accent" as any]: accentVar }}
    >
      {/* Heading row: number + type | regulation badge | significance badge */}
      <div className={styles.heading}>
        <span className={styles.noteType}>
          {i + 1}. {v.note_type}
        </span>
        {v.relevant_regulation && (
          <RegBadge regulation={v.relevant_regulation} />
        )}
        <span className={styles.spacer} />
        <span className={styles.sigBadge} style={{ color: vLabelColor }}>
          {v.significance.toUpperCase()}
        </span>
      </div>

      {/* Description */}
      <div className={styles.description}>{v.description}</div>

      {/* HFACS */}
      <div className={v.transcript_excerpt ? styles.hfacsRowWithExcerpt : styles.hfacsRow}>
        <span className={styles.hfacsLabel}>HFACS</span>
        <span className={styles.hfacsCode}>{v.hfacs_level}</span>
        <span className={styles.hfacsPlain}>{hfacsPlain}</span>
      </div>

      {/* Safety pathway */}
      {v.safety_pathway && (
        <div className={v.transcript_excerpt ? styles.safetyPathwayWithExcerpt : styles.safetyPathway}>
          ⚡ {v.safety_pathway}
        </div>
      )}

      {/* Transcript excerpt */}
      {v.transcript_excerpt && (
        <div className={styles.excerpt}>
          "{v.transcript_excerpt}"
        </div>
      )}
    </div>
  );
}
