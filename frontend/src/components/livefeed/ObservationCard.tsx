import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { getCardSeverity, SEV_ORDER } from "../../lib/severity";
import type { AnalysisResult } from "../../lib/types";
import { extractCallsign, extractActions, parseBullets } from "../../lib/transcript";
import { useWatchList } from "../../hooks/useWatchList";
import { SEV_LABEL, SEV_ICON, ACTION_REQUIRED, ACTION_TOKEN } from "./constants";
import { SectionLabel } from "./SectionLabel";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { HazardBanner } from "./HazardBanner";
import { StructuredTranscript } from "./StructuredTranscript";
import { PositionSnapshot } from "./PositionSnapshot";
import { ObservationItem } from "./ObservationItem";
import { ReportActions } from "./ReportActions";
import styles from "./ObservationCard.module.css";

interface Props {
  r: AnalysisResult;
  priorOccurrences?: number;
  lastSeenAgo?: string | null;
}

export function ObservationCard({ r, priorOccurrences, lastSeenAgo }: Props) {
  const severity   = getCardSeverity(r);
  const posDefault = severity === "critical" || severity === "high";
  const [showTranscript, setShowTranscript] = useState(true);
  const [showPosition,   setShowPosition]   = useState(posDefault);
  const [watchList, toggleWatch] = useWatchList();

  const actions       = extractActions(r.transcript);
  const enrichCallsign = r.enrichment?.callsign_detected ?? null;
  const enrichClarity  = r.enrichment?.callsign_clarity ?? 0;
  const { callsign: regexCallsign, confidence: regexConf } = extractCallsign(r.transcript);
  const callsign      = enrichClarity >= 50 ? enrichCallsign : (enrichCallsign ?? regexCallsign);
  const confidence    = enrichClarity >= 75 ? "high" : (enrichClarity >= 40 ? "low" : regexConf);

  const icon          = SEV_ICON[severity] ?? "•";
  const labelTextColor = ["low", "medium"].includes(severity) ? "var(--bg)" : "white";
  const bullets       = r.summary ? parseBullets(r.summary) : [];

  const phraseologyNotes = r.observations?.length > 0
    ? [...r.observations]
        .filter(v => v.kind === "phraseology_note")
        .sort((a, b) => (SEV_ORDER[b.significance] ?? 0) - (SEV_ORDER[a.significance] ?? 0))
    : [];
  const situationalEvents = r.observations?.length > 0
    ? [...r.observations]
        .filter(v => v.kind === "situational_event")
        .sort((a, b) => (SEV_ORDER[b.significance] ?? 0) - (SEV_ORDER[a.significance] ?? 0))
    : [];

  return (
    <div
      id={r.id ? `result-${r.id}` : undefined}
      className={styles.card}
      style={{
        ["--sev-border" as any]: `var(--sev-${severity}-border)`,
        ["--sev-bg" as any]: `var(--sev-${severity}-bg)`,
      }}
    >

      {/* ── HEADER ── */}
      <div className={styles.header}>
        {/* Left */}
        <div className={styles.headerLeft}>
          <span className={styles.sevBadge} style={{ color: labelTextColor }}>
            {SEV_LABEL[severity]}
          </span>
          <span className={styles.airportCode}>{r.airport_code}</span>
          {callsign && (
            <span className={styles.callsign}>{callsign}</span>
          )}
          {callsign && (
            <button
              onClick={() => toggleWatch(callsign)}
              title={watchList.has(callsign) ? "Remove from watch list" : "Watch this callsign"}
              className={`${styles.watchBtn} ${watchList.has(callsign) ? styles.watchBtnActive : styles.watchBtnInactive}`}
            >
              {watchList.has(callsign) ? "★" : "☆"}
            </button>
          )}
          {r.observations?.length > 0 && (
            <span className={styles.obsCount}>
              · {r.observations.length} observation{r.observations.length !== 1 ? "s" : ""}
            </span>
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
        </div>

        {/* Right: timestamp · AI confidence */}
        <div className={styles.headerRight}>
          <span className={styles.timestamp}>
            {formatDistanceToNow(new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z"), { addSuffix: true })}
          </span>
          <ConfidenceBadge score={r.confidence_score} />
        </div>
      </div>

      {/* ── Watch list highlight ── */}
      {callsign && watchList.has(callsign) && (
        <div className={styles.watchHighlight}>
          <span className={styles.watchLabel}>★ WATCHED CALLSIGN</span>
          <span className={styles.watchSub}>{callsign} is on your watch list</span>
        </div>
      )}

      {/* ── Prior occurrence alert ── */}
      {priorOccurrences != null && priorOccurrences > 0 && callsign && (
        <div className={styles.priorAlert}>
          <span className={styles.priorAlertIcon}>⚠</span>
          <span className={styles.priorAlertText}>
            <strong>{callsign}</strong> — {priorOccurrences + 1}th occurrence this session
            {lastSeenAgo ? ` (previous: ${lastSeenAgo})` : ""}
          </span>
        </div>
      )}

      {/* ── Hazard banner — SIGMET / AIRMET / PIREP active at observation time ── */}
      <HazardBanner airport={r.airport_code} timestamp={r.timestamp} />

      {/* ── 1. WHAT HAPPENED ── */}
      {bullets.length > 0 && (
        <div className={styles.whatHappened}>
          <SectionLabel>What happened</SectionLabel>
          <div className={styles.bulletList}>
            {bullets.map((text, i) => (
              <div key={i} className={styles.bulletRow}>
                <span className={styles.bulletDash}>—</span>
                <span className={styles.bulletText}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 2. EVIDENCE — transcript + position snapshot ── */}
      <div className={styles.evidence}>
        <SectionLabel>Evidence</SectionLabel>

        {/* Toggle buttons — side by side */}
        <div className={styles.toggleRow}>
          <button
            onClick={() => setShowTranscript(v => !v)}
            className={styles.transcriptToggle}
          >
            <span className={styles.toggleIcon}>{"</>"}</span>
            {showTranscript ? "Hide transcript" : "View transcript"}
          </button>

          <button
            onClick={() => setShowPosition(v => !v)}
            className={`${styles.posToggle} ${showPosition ? styles.posToggleActive : styles.posToggleInactive}`}
          >
            <span style={{ fontSize: 10 }}>⊙</span>
            {showPosition ? "Hide position" : "Show position"}
          </button>
        </div>

        {/* Transcript block — structured if enrichment available */}
        {showTranscript && (
          <div className={styles.transcriptBlock}>
            <StructuredTranscript
              enrichment={r.enrichment}
              rawTranscript={r.transcript}
              borderColor="var(--sev-border)"
              assessableConfidence={r.assessable_confidence}
            />
          </div>
        )}

        {/* Position snapshot block */}
        {showPosition && (
          <PositionSnapshot r={r} callsign={callsign} confidence={confidence} borderColor="var(--sev-border)" />
        )}
      </div>

      {/* ── 3. ANALYSIS — observations split by kind ── */}
      {r.observations?.length > 0 && (
        <div className={styles.analysis}>
          {/* Advisory tooltip icon */}
          <div className={styles.analysisHeader}>
            <SectionLabel>Analysis</SectionLabel>
            <span
              title="Advisory — transcription may be imperfect and feeds are often one-sided."
              className={styles.advisoryIcon}
            >
              ⓘ
            </span>
          </div>

          {/* Phraseology Notes subsection */}
          {phraseologyNotes.length > 0 && (
            <div className={situationalEvents.length > 0 ? styles.phraseologyGroup : styles.phraseologyGroupLast}>
              <div className={styles.phraseologyLabel}>Phraseology Notes</div>
              <div className={styles.observationList}>
                {phraseologyNotes.map((v, i) => (
                  <ObservationItem
                    key={i}
                    observation={v}
                    index={i}
                    isLast={i === phraseologyNotes.length - 1}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Situational Events subsection */}
          {situationalEvents.length > 0 && (
            <div>
              <div className={styles.situationalLabel}>Situational Events</div>
              <div className={styles.observationList}>
                {situationalEvents.map((v, i) => (
                  <ObservationItem
                    key={i}
                    observation={v}
                    index={i}
                    isLast={i === situationalEvents.length - 1}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 4. REVIEW GUIDANCE ── */}
      <div className={styles.reviewGuidance}>
        <div className={styles.guidanceBox}>
          <span className={styles.guidanceIcon}>{icon}</span>
          <div className={styles.guidanceContent}>
            <div className={styles.guidanceLabel}>Review Guidance</div>
            <p className={styles.guidanceText}>
              {ACTION_REQUIRED[severity] ?? "Document and review this observation."}
            </p>
          </div>
        </div>
      </div>

      {/* ── 5. REVIEW ── */}
      <ReportActions r={r} callsign={callsign} />

    </div>
  );
}
