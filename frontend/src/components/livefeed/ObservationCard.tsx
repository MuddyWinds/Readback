import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { getCardSeverity } from "../../lib/severity";
import type { AnalysisResult, Observation } from "../../lib/types";
import { extractCallsign, extractActions, parseBullets } from "../../lib/transcript";
import { buildDisplayFindings, attributedCallsigns, findingPoints } from "../../lib/findings";
import { useWatchList } from "../../hooks/useWatchList";
import { SEV_LABEL, SEV_ICON, ACTION_REQUIRED, ACTION_TOKEN } from "./constants";
import { SectionLabel } from "./SectionLabel";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { HazardBanner } from "./HazardBanner";
import { StructuredTranscript } from "./StructuredTranscript";
import { PositionSnapshot } from "./PositionSnapshot";
import { ObservationItem } from "./ObservationItem";
import type { ReadbackComparison } from "./ObservationItem";
import { ReportActions } from "./ReportActions";
import styles from "./ObservationCard.module.css";

interface Props {
  r: AnalysisResult;
  priorOccurrences?: number;
  lastSeenAgo?: string | null;
  onSelectAircraft?: (sel: { icao24: string | null; callsign: string | null } | null) => void;
  onOpenResultContext?: (
    r: AnalysisResult,
    sel: { icao24: string | null; callsign: string | null } | null,
  ) => void;
}

function isInteractiveClick(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(
    "button,a,input,select,textarea,[role='button']",
  );
}

export function ObservationCard({ r, priorOccurrences, lastSeenAgo, onSelectAircraft, onOpenResultContext }: Props) {
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
  const labelTextColor = ["low", "medium", "high"].includes(severity) ? "var(--bg)" : "white";
  const bullets       = r.summary ? parseBullets(r.summary) : [];

  const baseObservationCount = r.observations?.length ?? 0;
  const baseReadbackComparison =
    r.enrichment?.readback_correct === false && r.enrichment.readback_discrepancy
      ? {
        atcInstruction: r.enrichment.atc_instruction,
        pilotReadback: r.enrichment.pilot_readback,
        discrepancy: r.enrichment.readback_discrepancy,
        lowConfidence: (r.assessable_confidence ?? 1) < 0.6,
      }
      : null;

  const hasReadbackFinding = !!baseReadbackComparison
    && (r.observations ?? []).some(o => o.note_type === "Read-back Error");

  const syntheticReadback: Observation | null =
    baseReadbackComparison && !hasReadbackFinding
      ? {
        kind: "phraseology_note",
        note_type: "Read-back Error",
        hfacs_level: "Unsafe Act",
        significance: baseReadbackComparison.lowConfidence ? "low" : "medium",
        description: baseReadbackComparison.discrepancy,
        safety_pathway: null,
        relevant_regulation: null,
        transcript_excerpt: null,
        callsign: callsign ?? null,
      }
      : null;

  let nextPointId = 1;
  const findings = buildDisplayFindings(r.observations ?? [], syntheticReadback).map(f => {
    const points = findingPoints(f, nextPointId);
    nextPointId += points.length;
    return { ...f, points };
  });
  const notes       = findings.filter(f => f.type === "phraseology_note");
  const events      = findings.filter(f => f.type === "situational_event");
  const showTypeLabels = notes.length > 0 && events.length > 0;
  const readbackAnchor = baseReadbackComparison
    ? findings.find(f => f.observation.note_type === "Read-back Error")
    : undefined;
  const readbackMarkId =
    baseReadbackComparison && (baseReadbackComparison.atcInstruction || baseReadbackComparison.pilotReadback)
      ? nextPointId++
      : null;
  const readbackComparison: ReadbackComparison | null =
    baseReadbackComparison && readbackAnchor
      ? {
        ...baseReadbackComparison,
        needsReview: readbackAnchor.synthetic || baseReadbackComparison.lowConfidence,
        unconfirmed: readbackAnchor.synthetic,
        markId: readbackMarkId,
      }
      : null;
  const readbackFindingN = readbackAnchor?.n;
  const excerptMarks = [
    ...findings.flatMap(f => f.points
      .filter(point => point.excerpt)
      .map(point => ({ n: point.id, label: point.label, excerpt: point.excerpt as string }))),
    ...(baseReadbackComparison?.atcInstruction && readbackMarkId != null
      ? [{ n: readbackMarkId, label: "ATC", excerpt: baseReadbackComparison.atcInstruction }]
      : []),
    ...(baseReadbackComparison?.pilotReadback && readbackMarkId != null
      ? [{ n: readbackMarkId, label: "PIL", excerpt: baseReadbackComparison.pilotReadback }]
      : []),
  ];

  // Attribution is derived from the findings' own callsigns (NOT speaker
  // segments): a transcript that merely mentions two aircraft but attributes one
  // finding stays single-aircraft.
  const cardCallsigns = attributedCallsigns(r.observations ?? []);
  const isMulti = cardCallsigns.length >= 2;

  const [activeMark, setActiveMark] = useState<number | null>(null);
  const icaoByCallsign = React.useRef<Map<string, string | null>>(new Map());

  const activate = (n: number, cs: string | null) => {
    setActiveMark(n);
    onSelectAircraft?.({ icao24: cs ? (icaoByCallsign.current.get(cs) ?? null) : null, callsign: cs });
  };
  const deactivate = () => { setActiveMark(null); onSelectAircraft?.(null); };
  const openContext = (event: React.MouseEvent) => {
    if (isInteractiveClick(event.target)) return;
    onOpenResultContext?.(r, callsign
      ? { icao24: icaoByCallsign.current.get(callsign) ?? null, callsign }
      : null);
  };

  return (
    <div
      id={r.id ? `result-${r.id}` : undefined}
      className={styles.card}
      onClick={openContext}
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
          {baseObservationCount > 0 && (
            <span className={styles.obsCount}>
              · {baseObservationCount} observation{baseObservationCount !== 1 ? "s" : ""}
            </span>
          )}
          {actions.map(a => (
            <span
              key={a}
              className={styles.actionChip}
              style={{ ["--chip-accent" as any]: `var(${ACTION_TOKEN[a] ?? "--text-dim"})` }}
            >
              {a}
            </span>
          ))}
        </div>

        {/* Right: timestamp · AI confidence · STT confidence */}
        <div className={styles.headerRight}>
          <span className={styles.timestamp}>
            {formatDistanceToNow(new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z"), { addSuffix: true })}
          </span>
          <ConfidenceBadge score={r.confidence_score} />
          {r.assessable_confidence != null && (
            <span
              data-testid="stt-confidence"
              className={styles.sttBadge}
              title="Speech-to-text transcription confidence (not AI analysis confidence)"
            >
              STT {Math.round(r.assessable_confidence * 100)}%
            </span>
          )}
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

      {/* ── 2. EVIDENCE — transcript (once) + position toggle ── */}
      <div className={styles.evidence}>
        <SectionLabel>Evidence</SectionLabel>

        <div className={styles.toggleRow}>
          <button onClick={() => setShowTranscript(v => !v)} className={styles.transcriptToggle}>
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

        {showTranscript && (
          <div data-testid="evidence-transcript" className={styles.transcriptBlock}>
            <StructuredTranscript
              enrichment={r.enrichment}
              rawTranscript={r.transcript}
              borderColor="var(--sev-border)"
              excerptMarks={excerptMarks}
              activeMark={activeMark}
              onMarkHover={setActiveMark}
            />
          </div>
        )}

        {showPosition && (
          isMulti ? (
            cardCallsigns.map(cs => (
              <div key={cs} data-testid="position-snapshot" className={styles.transcriptBlock}>
                <div className={styles.groupHeading}>{cs}</div>
                <PositionSnapshot
                  r={r}
                  callsign={cs}
                  confidence={confidence}
                  borderColor="var(--sev-border)"
                  onResolved={(c, icao) => { if (c) icaoByCallsign.current.set(c, icao); }}
                />
              </div>
            ))
          ) : callsign ? (
            <div data-testid="position-snapshot" className={styles.transcriptBlock}>
              <PositionSnapshot
                r={r}
                callsign={callsign}
                confidence={confidence}
                borderColor="var(--sev-border)"
                onResolved={(cs, icao) => { if (cs) icaoByCallsign.current.set(cs, icao); }}
              />
            </div>
          ) : null
        )}
      </div>

      {/* ── 3. ANALYSIS — flat, numbered findings (NO transcript) ── */}
      <div className={styles.analysis}>
        <div className={styles.analysisHeader}>
          <SectionLabel>Analysis</SectionLabel>
          <span
            title="Advisory — transcription may be imperfect and feeds are often one-sided."
            className={styles.advisoryIcon}
          >
            ⓘ
          </span>
        </div>

        {notes.length > 0 && (
          <div className={styles.observationList}>
            {showTypeLabels && <div className={styles.phraseologyLabel}>Phraseology Notes</div>}
            {notes.map(f => (
              <ObservationItem
                key={f.n}
                observation={f.observation}
                n={f.n}
                points={f.points}
                readbackComparison={f.n === readbackFindingN ? readbackComparison : null}
                isLast={f.n === findings.length}
                callsign={isMulti ? (f.observation.callsign ?? null) : null}
                active={
                  f.points.some(point => point.id === activeMark)
                  || (f.n === readbackFindingN && readbackMarkId === activeMark)
                }
                activePointId={activeMark}
                onActivate={() => activate(f.points[0]?.id ?? f.n, f.observation.callsign ?? (isMulti ? null : callsign))}
                onPointActivate={id => activate(id, f.observation.callsign ?? (isMulti ? null : callsign))}
                onReadbackActivate={id => activate(id, f.observation.callsign ?? (isMulti ? null : callsign))}
                onDeactivate={deactivate}
              />
            ))}
          </div>
        )}

        {events.length > 0 && (
          <div className={styles.observationList}>
            {showTypeLabels && <div className={styles.situationalLabel}>Situational Events</div>}
            {events.map(f => (
              <ObservationItem
                key={f.n}
                observation={f.observation}
                n={f.n}
                points={f.points}
                readbackComparison={f.n === readbackFindingN ? readbackComparison : null}
                isLast={f.n === findings.length}
                callsign={isMulti ? (f.observation.callsign ?? null) : null}
                active={
                  f.points.some(point => point.id === activeMark)
                  || (f.n === readbackFindingN && readbackMarkId === activeMark)
                }
                activePointId={activeMark}
                onActivate={() => activate(f.points[0]?.id ?? f.n, f.observation.callsign ?? (isMulti ? null : callsign))}
                onPointActivate={id => activate(id, f.observation.callsign ?? (isMulti ? null : callsign))}
                onReadbackActivate={id => activate(id, f.observation.callsign ?? (isMulti ? null : callsign))}
                onDeactivate={deactivate}
              />
            ))}
          </div>
        )}
      </div>

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
