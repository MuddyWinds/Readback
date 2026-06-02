import React from "react";
import type { FindingPoint } from "../../lib/findings";
import type { Observation } from "../../lib/types";
import { HFACS_PLAIN } from "./constants";
import { RegBadge } from "./RegBadge";
import styles from "./ObservationItem.module.css";

export interface ReadbackComparison {
  atcInstruction: string | null;
  pilotReadback: string | null;
  discrepancy: string;
  lowConfidence: boolean;
  needsReview: boolean;
  unconfirmed: boolean;
  markId: number | null;
}

interface Props {
  observation: Observation;
  n: number;
  points?: FindingPoint[];
  readbackComparison?: ReadbackComparison | null;
  isLast: boolean;
  callsign?: string | null;
  active?: boolean;
  activePointId?: number | null;
  onActivate?: () => void;
  onPointActivate?: (id: number) => void;
  onReadbackActivate?: (id: number) => void;
  onDeactivate?: () => void;
}

function safetySteps(pathway: string): string[] {
  return pathway.split(/\s*(?:→|->|↳)\s*/).map(s => s.trim()).filter(Boolean);
}

export function ObservationItem({
  observation: v,
  n,
  points,
  readbackComparison,
  isLast,
  callsign,
  active,
  activePointId,
  onActivate,
  onPointActivate,
  onReadbackActivate,
  onDeactivate,
}: Props) {
  const vLabelColor = ["medium", "low"].includes(v.significance) ? "var(--bg)" : "white";
  const hfacsPlain = HFACS_PLAIN[v.hfacs_level] ?? v.hfacs_level;
  const accentVar = `var(--sev-${v.significance})`;
  const displayPoints = points?.length
    ? points
    : [{ id: n, label: String(n), text: v.description, excerpt: v.transcript_excerpt ?? null }];
  const hasSubPoints = displayPoints.length > 1 || displayPoints[0]?.label !== String(n);
  const pathwaySteps = v.safety_pathway ? safetySteps(v.safety_pathway) : [];
  const deactivateAfterLeavingRow = (event: React.MouseEvent<HTMLDivElement> | React.FocusEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    onDeactivate?.();
  };

  return (
    <div
      data-testid="finding-row"
      className={`${isLast ? styles.rowLast : styles.row} ${active ? styles.rowActive : ""}`}
      style={{ ["--accent" as any]: accentVar }}
      tabIndex={hasSubPoints ? -1 : 0}
      onMouseEnter={hasSubPoints ? undefined : onActivate}
      onMouseLeave={deactivateAfterLeavingRow}
      onFocus={hasSubPoints ? undefined : onActivate}
      onBlur={deactivateAfterLeavingRow}
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
        {hasSubPoints ? (
          <span className={styles.pointList}>
            {displayPoints.map(point => (
              <span
                key={point.id}
                data-testid="finding-point-row"
                className={`${styles.pointRow} ${activePointId === point.id ? styles.pointRowActive : ""}`}
                tabIndex={0}
                onMouseEnter={() => onPointActivate?.(point.id)}
                onFocus={() => onPointActivate?.(point.id)}
                onBlur={onDeactivate}
              >
                <span data-testid="finding-point-label" className={styles.pointLabel}>{point.label}</span>
                <span className={styles.pointText}>{point.text}</span>
              </span>
            ))}
          </span>
        ) : (
          <span className={styles.bodyText}>{displayPoints[0]?.text ?? v.description}</span>
        )}
      </div>

      {readbackComparison && (
        <div
          data-testid="finding-readback-comparison"
          className={styles.readbackCompare}
          tabIndex={readbackComparison.markId != null ? 0 : undefined}
          onMouseEnter={() => {
            if (readbackComparison.markId != null) onReadbackActivate?.(readbackComparison.markId);
          }}
          onFocus={() => {
            if (readbackComparison.markId != null) onReadbackActivate?.(readbackComparison.markId);
          }}
          onMouseLeave={onDeactivate}
          onBlur={onDeactivate}
        >
          <div className={styles.readbackCompareHeader}>
            <span className={styles.readbackCompareHeading}>Readback comparison</span>
            {readbackComparison.unconfirmed && (
              <span className={styles.readbackStatusBadge}>detected · unconfirmed</span>
            )}
            {readbackComparison.needsReview && (
              <span className={styles.needsReviewBadge}>Needs review</span>
            )}
          </div>
          <div className={styles.readbackDelta}>{readbackComparison.discrepancy}</div>
          {readbackComparison.lowConfidence && (
            <div className={styles.readbackCompareCaveat}>
              Transcript quality insufficient to verify readback; manual review required.
            </div>
          )}
        </div>
      )}

      {/* Why it matters (promoted safety_pathway) */}
      {v.safety_pathway && (
        <div className={styles.bodyRow}>
          <span className={styles.bodyLabel}>Why it matters</span>
          <span className={styles.bodyText}>
            {pathwaySteps.length > 1 ? (
              <span className={styles.safetyChain}>
                {pathwaySteps.map((step, i) => (
                  <span key={`${step}-${i}`}>{i === 0 ? step : `↳ ${step}`}</span>
                ))}
              </span>
            ) : v.safety_pathway}
          </span>
        </div>
      )}

      {/* HFACS — demoted to a neutral tag */}
      <div className={styles.hfacsTag} title="HFACS classification">
        ⌑ HFACS · {v.hfacs_level} · {hfacsPlain}
      </div>
    </div>
  );
}
