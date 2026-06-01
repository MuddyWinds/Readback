import React from "react";
import type { Observation } from "../../lib/types";
import { HFACS_PLAIN } from "./constants";
import { RegBadge } from "./RegBadge";
import styles from "./ObservationItem.module.css";

interface Props {
  observation: Observation;
  n: number;
  isLast: boolean;
  callsign?: string | null;
  active?: boolean;
  onActivate?: () => void;
  onDeactivate?: () => void;
}

export function ObservationItem({ observation: v, n, isLast, callsign, active, onActivate, onDeactivate }: Props) {
  const vLabelColor = ["medium", "low"].includes(v.significance) ? "var(--bg)" : "white";
  const hfacsPlain = HFACS_PLAIN[v.hfacs_level] ?? v.hfacs_level;
  const accentVar = `var(--sev-${v.significance})`;

  return (
    <div
      className={`${isLast ? styles.rowLast : styles.row} ${active ? styles.rowActive : ""}`}
      style={{ ["--accent" as any]: accentVar }}
      tabIndex={0}
      onMouseEnter={onActivate}
      onMouseLeave={onDeactivate}
      onFocus={onActivate}
      onBlur={onDeactivate}
    >
      {/* Heading: number badge + type | callsign chip | regulation | significance */}
      <div className={styles.heading}>
        <span data-testid="finding-number" className={styles.markBadge}>{n}</span>
        <span className={styles.noteType}>{v.note_type}</span>
        {callsign && <span className={styles.callsignChip}>{callsign}</span>}
        {v.relevant_regulation && <RegBadge regulation={v.relevant_regulation} />}
        <span className={styles.spacer} />
        <span className={styles.sigBadge} style={{ color: vLabelColor }}>
          {v.significance.toUpperCase()}
        </span>
      </div>

      {/* What happened */}
      <div className={styles.bodyRow}>
        <span className={styles.bodyLabel}>What happened</span>
        <span className={styles.bodyText}>{v.description}</span>
      </div>

      {/* Why it matters (promoted safety_pathway) */}
      {v.safety_pathway && (
        <div className={styles.bodyRow}>
          <span className={styles.bodyLabel}>Why it matters</span>
          <span className={styles.bodyText}>{v.safety_pathway}</span>
        </div>
      )}

      {/* HFACS — demoted to a neutral tag */}
      <div className={styles.hfacsTag} title="HFACS classification">
        ⌑ HFACS · {v.hfacs_level} · {hfacsPlain}
      </div>
    </div>
  );
}
