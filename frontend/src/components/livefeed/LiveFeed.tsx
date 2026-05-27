import React, { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { getCardSeverity, SEV_ORDER } from "../../lib/severity";
import type { AnalysisResult, Enrichment, Observation, Severity, Filter } from "../../lib/types";
import { extractCallsign, extractActions, parseBullets } from "../../lib/transcript";
import { buildReportText } from "../../lib/report";
import { useWatchList } from "../../hooks/useWatchList";
import { SEV_LABEL, SEV_ICON, ACTION_REQUIRED, HFACS_PLAIN, STATUS_LABEL, ReviewStatus } from "./constants";
import { SectionLabel } from "./SectionLabel";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { RegBadge } from "./RegBadge";
import { HazardBanner } from "./HazardBanner";
import { StructuredTranscript } from "./StructuredTranscript";
import { StatusWorkflow } from "./StatusWorkflow";
import { ReviewerNotes } from "./ReviewerNotes";
import { PositionSnapshot } from "./PositionSnapshot";

export type {
  SpeakerSegment, Enrichment, ObservationKind, Observation,
  AnalysisResult, Severity, Filter, GroupBy,
} from "../../lib/types";
export { getCardSeverity, SEV_ORDER } from "../../lib/severity";

interface PipelineStatusSummary {
  queued_transcripts: number;
  next_batch_at: string | null;
  last_audio_at: string | null;
  last_gemini_error: string | null;
}

const SEV_BORDER: Record<Severity, string> = {
  standard: "#238636", low: "#44aaff", medium: "#e3b341", high: "#ff8800", critical: "#ff4444",
  unassessable: "#3a3f47",
};
const SEV_BG: Record<Severity, string> = {
  standard: "#0d1117", low: "#0d1527", medium: "#1f1a0d", high: "#1a1005", critical: "#1f0d0d",
  unassessable: "#0d1117",
};
const SEV_COLOR: Record<string, string> = {
  critical: "#ff4444", high: "#ff8800", medium: "#e3b341", low: "#44aaff", unassessable: "#484f58",
};

const ACTION_COLOR: Record<string, string> = {
  CLIMB: "#3fb950", DESCEND: "#58a6ff", TAKEOFF: "#d2a8ff", LANDING: "#79c0ff",
  "GO AROUND": "#ff7b72", HOLD: "#e3b341", EMERGENCY: "#ff4444", TURN: "#a5d6ff",
  SPEED: "#ffa657", "FREQ CHANGE": "#8b949e", PUSHBACK: "#bc8cff", TAXI: "#c9d1d9",
};

// ── Review workflow ───────────────────────────────────────────────────────────

// ─── Standard card — minimal horizontal bar, expands on click ────────────────
function CompliantCard({ r }: { r: AnalysisResult }) {
  const [expanded, setExpanded] = useState(false);
  const { callsign } = extractCallsign(r.transcript);
  const actions = extractActions(r.transcript);

  return (
    <div
      id={r.id ? `result-${r.id}` : undefined}
      style={{
        background: "#0d1117",
        border: "1px solid #23863650",
        borderLeft: "3px solid #23863688",
        borderRadius: 8,
        overflow: "hidden",
        cursor: "pointer",
      }}
      onClick={() => setExpanded(v => !v)}
    >
      {/* Single-line header — all info in one row */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "9px 14px", flexWrap: "wrap",
      }}>
        <span style={{
          background: "#238636", color: "#fff",
          padding: "2px 9px", borderRadius: 12,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5, flexShrink: 0,
        }}>
          STANDARD
        </span>
        <span style={{
          background: "#161b22", color: "#8b949e",
          padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {r.airport_code}
        </span>
        {callsign && (
          <span style={{ fontSize: 11, color: "#6e7681", fontFamily: "monospace", flexShrink: 0 }}>
            {callsign}
          </span>
        )}
        {actions.map(a => (
          <span key={a} style={{
            background: "#161b22",
            border: `1px solid ${ACTION_COLOR[a] ?? "#555"}44`,
            color: `${ACTION_COLOR[a] ?? "#ccc"}99`,
            padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600, flexShrink: 0,
          }}>
            {a}
          </span>
        ))}
        {/* Spacer */}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#30363d", whiteSpace: "nowrap" }}>
          {formatDistanceToNow(new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z"), { addSuffix: true })}
        </span>
        <span style={{ fontSize: 10, color: "#30363d" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded: analysis, structured transcript, investigation */}
      {expanded && (
        <div
          style={{ borderTop: "1px solid #23863622" }}
          onClick={e => e.stopPropagation()}
        >
          {/* Analysis */}
          {r.summary && (
            <div style={{ padding: "10px 14px 0" }}>
              <SectionLabel>Analysis</SectionLabel>
              <p style={{ fontSize: 12, color: "#c9d1d9", margin: 0, lineHeight: 1.75 }}>
                {r.summary}
              </p>
            </div>
          )}

          {/* Structured transcript */}
          <div style={{ padding: "10px 14px 0" }}>
            <SectionLabel>Transcript</SectionLabel>
            <StructuredTranscript
              enrichment={r.enrichment}
              rawTranscript={r.transcript}
              borderColor="#238636"
              assessableConfidence={r.assessable_confidence}
            />
          </div>

          {/* Review */}
          <div style={{
            margin: "10px 14px 12px",
            background: "#0d1117", border: "1px solid #21262d",
            borderRadius: 6, padding: "10px 12px",
            display: "flex", flexDirection: "column" as const, gap: 12,
          }}>
            <StatusWorkflow resultId={r.id} initial={r.status} />
            <ReviewerNotes resultId={r.id} initial={r.reviewer_notes} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Observation card — full detail ──────────────────────────────────────────
function ObservationCard({ r, priorOccurrences, lastSeenAgo }: {
  r: AnalysisResult;
  priorOccurrences?: number;
  lastSeenAgo?: string | null;
}) {
  const severity    = getCardSeverity(r);
  const posDefault  = severity === "critical" || severity === "high";
  const [showTranscript, setShowTranscript] = useState(true);
  const [showPosition,   setShowPosition]   = useState(posDefault);
  const [watchList, toggleWatch] = useWatchList();
  const [reportCopied, setReportCopied] = useState(false);

  const borderColor    = SEV_BORDER[severity];
  const actions        = extractActions(r.transcript);
  // Prefer Gemini-detected callsign (higher clarity); fall back to local regex
  const enrichCallsign  = r.enrichment?.callsign_detected ?? null;
  const enrichClarity   = r.enrichment?.callsign_clarity ?? 0;
  const { callsign: regexCallsign, confidence: regexConf } = extractCallsign(r.transcript);
  const callsign        = enrichClarity >= 50 ? enrichCallsign : (enrichCallsign ?? regexCallsign);
  const confidence      = enrichClarity >= 75 ? "high" : (enrichClarity >= 40 ? "low" : regexConf);

  const icon           = SEV_ICON[severity] ?? "•";
  const labelTextColor = ["low", "medium"].includes(severity) ? "#0d1117" : "#fff";
  const bullets        = r.summary ? parseBullets(r.summary) : [];
  // confLow kept for backward compat but replaced by ConfidenceBadge
  const confPct        = Math.round(r.confidence_score * 100);
  const confLow        = confPct < 65;

  return (
    <div id={r.id ? `result-${r.id}` : undefined} style={{
      background: SEV_BG[severity],
      border: `1px solid ${borderColor}`,
      borderLeft: `4px solid ${borderColor}`,
      borderRadius: 8,
      overflow: "hidden",
    }}>

      {/* ── HEADER ── */}
      <div style={{
        padding: "11px 16px",
        borderBottom: `1px solid ${borderColor}22`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        {/* Left */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{
            background: borderColor, color: labelTextColor,
            padding: "2px 10px", borderRadius: 12,
            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          }}>
            {SEV_LABEL[severity]}
          </span>
          <span style={{
            background: "#21262d", color: "#e6edf3",
            padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 700,
          }}>
            {r.airport_code}
          </span>
          {callsign && (
            <span style={{ fontSize: 12, color: "#c9d1d9", fontFamily: "monospace", fontWeight: 600 }}>
              {callsign}
            </span>
          )}
          {callsign && (
            <button
              onClick={() => toggleWatch(callsign)}
              title={watchList.has(callsign) ? "Remove from watch list" : "Watch this callsign"}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "0 2px",
                fontSize: 14, lineHeight: 1, color: watchList.has(callsign) ? "#e3b341" : "#3a3f47",
                transition: "color 0.15s", flexShrink: 0,
              }}
            >
              {watchList.has(callsign) ? "★" : "☆"}
            </button>
          )}
          {r.observations?.length > 0 && (
            <span style={{ fontSize: 11, color: "#8b949e" }}>
              · {r.observations.length} observation{r.observations.length !== 1 ? "s" : ""}
            </span>
          )}
          {actions.map(a => (
            <span key={a} style={{
              background: "#161b22",
              border: `1px solid ${ACTION_COLOR[a] ?? "#555"}`,
              color: ACTION_COLOR[a] ?? "#ccc",
              padding: "1px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600,
            }}>
              {a}
            </span>
          ))}
        </div>

        {/* Right: timestamp · AI confidence */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 12, flexShrink: 0 }}>
          <span style={{ fontSize: 11, color: "#484f58", whiteSpace: "nowrap" }}>
            {formatDistanceToNow(new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z"), { addSuffix: true })}
          </span>
          <ConfidenceBadge score={r.confidence_score} />
        </div>
      </div>

      {/* ── Watch list highlight ── */}
      {callsign && watchList.has(callsign) && (
        <div style={{
          padding: "4px 16px",
          background: "#e3b34118", borderBottom: "1px solid #e3b34130",
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#e3b341" }}>★ WATCHED CALLSIGN</span>
          <span style={{ fontSize: 10, color: "#8b949e" }}>{callsign} is on your watch list</span>
        </div>
      )}

      {/* ── Prior occurrence alert ── */}
      {priorOccurrences != null && priorOccurrences > 0 && callsign && (
        <div style={{
          padding: "6px 16px",
          background: "#e3b34110", borderBottom: `1px solid #e3b34130`,
          display: "flex", alignItems: "center", gap: 6,
        }}>
          <span style={{ fontSize: 10 }}>⚠</span>
          <span style={{ fontSize: 11, color: "#e3b341" }}>
            <strong>{callsign}</strong> — {priorOccurrences + 1}th occurrence this session
            {lastSeenAgo ? ` (previous: ${lastSeenAgo})` : ""}
          </span>
        </div>
      )}

      {/* ── Hazard banner — SIGMET / AIRMET / PIREP active at observation time ── */}
      <HazardBanner airport={r.airport_code} timestamp={r.timestamp} />

      {/* ── 1. WHAT HAPPENED ── */}
      {bullets.length > 0 && (
        <div style={{
          padding: "14px 16px",
          borderBottom: `1px solid ${borderColor}18`,
          background: `${borderColor}08`,
        }}>
          <SectionLabel>What happened</SectionLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bullets.map((text, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                <span style={{ color: borderColor, fontSize: 13, flexShrink: 0, fontWeight: 700 }}>—</span>
                {/* Larger, brighter — situational awareness at a glance */}
                <span style={{ fontSize: 14, color: "#e6edf3", lineHeight: 1.55, fontWeight: 400 }}>
                  {text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 2. EVIDENCE — transcript + position snapshot ── */}
      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${borderColor}18` }}>
        <SectionLabel>Evidence</SectionLabel>

        {/* Toggle buttons — side by side */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
          <button
            onClick={() => setShowTranscript(v => !v)}
            style={{
              background: "none", border: "1px solid #30363d",
              borderRadius: 6, color: "#8b949e",
              fontSize: 11, padding: "4px 10px",
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
              transition: "border-color 0.1s",
            }}
          >
            <span style={{ fontFamily: "monospace", fontSize: 10 }}>{"</>"}</span>
            {showTranscript ? "Hide transcript" : "View transcript"}
          </button>

          <button
            onClick={() => setShowPosition(v => !v)}
            style={{
              background: "none", border: `1px solid ${showPosition ? borderColor + "66" : "#30363d"}`,
              borderRadius: 6, color: showPosition ? borderColor : "#8b949e",
              fontSize: 11, padding: "4px 10px",
              cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
              transition: "all 0.1s",
            }}
          >
            <span style={{ fontSize: 10 }}>⊙</span>
            {showPosition ? "Hide position" : "Show position"}
          </button>
        </div>

        {/* Transcript block — structured if enrichment available */}
        {showTranscript && (
          <div style={{ marginTop: 10 }}>
            <StructuredTranscript
              enrichment={r.enrichment}
              rawTranscript={r.transcript}
              borderColor={borderColor}
              assessableConfidence={r.assessable_confidence}
            />
          </div>
        )}

        {/* Position snapshot block */}
        {showPosition && (
          <PositionSnapshot r={r} callsign={callsign} confidence={confidence} borderColor={borderColor} />
        )}
      </div>

      {/* ── 3. ANALYSIS — observations split by kind ── */}
      {r.observations?.length > 0 && (() => {
        const phraseologyNotes = [...r.observations]
          .filter(v => v.kind === "phraseology_note")
          .sort((a, b) => (SEV_ORDER[b.significance] ?? 0) - (SEV_ORDER[a.significance] ?? 0));
        const situationalEvents = [...r.observations]
          .filter(v => v.kind === "situational_event")
          .sort((a, b) => (SEV_ORDER[b.significance] ?? 0) - (SEV_ORDER[a.significance] ?? 0));

        const renderObservation = (v: Observation, i: number, list: Observation[]) => {
          const vColor = SEV_COLOR[v.significance] ?? "#888";
          const vLabelColor = ["medium", "low"].includes(v.significance) ? "#0d1117" : "#fff";
          const hfacsPlain = HFACS_PLAIN[v.hfacs_level] ?? v.hfacs_level;
          const isLast = i === list.length - 1;
          return (
            <div key={i} style={{
              paddingBottom: 14,
              marginBottom: isLast ? 0 : 14,
              borderBottom: isLast ? "none" : "1px solid #21262d",
            }}>
              {/* Heading row: number + type | regulation badge | significance badge */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                flexWrap: "nowrap", marginBottom: 8, overflow: "hidden",
              }}>
                <span style={{
                  fontSize: 11, fontWeight: 700, color: vColor,
                  textTransform: "uppercase" as const, letterSpacing: 0.8,
                  whiteSpace: "nowrap", flexShrink: 0,
                }}>
                  {i + 1}. {v.note_type}
                </span>
                {v.relevant_regulation && (
                  <RegBadge regulation={v.relevant_regulation} />
                )}
                <span style={{ flex: 1 }} />
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: vLabelColor, background: vColor,
                  padding: "1px 8px", borderRadius: 10,
                  flexShrink: 0, whiteSpace: "nowrap",
                }}>
                  {v.significance.toUpperCase()}
                </span>
              </div>

              {/* Description */}
              <div style={{
                fontSize: 13, color: "#c9d1d9", lineHeight: 1.75,
                whiteSpace: "pre-wrap", marginBottom: 10,
              }}>
                {v.description}
              </div>

              {/* HFACS */}
              <div style={{
                display: "flex", alignItems: "center", gap: 8,
                marginBottom: v.transcript_excerpt ? 10 : 0,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, color: "#484f58",
                  letterSpacing: 1.1, textTransform: "uppercase" as const,
                }}>
                  HFACS
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: "#8b949e",
                  background: "#21262d", padding: "2px 7px",
                  borderRadius: 4, border: "1px solid #30363d",
                }}>
                  {v.hfacs_level}
                </span>
                <span style={{ fontSize: 11, color: "#6e7681" }}>
                  {hfacsPlain}
                </span>
              </div>

              {/* Safety pathway */}
              {v.safety_pathway && (
                <div style={{
                  fontSize: 11, color: "#8b949e", fontStyle: "italic",
                  lineHeight: 1.6, marginBottom: v.transcript_excerpt ? 8 : 0,
                  paddingLeft: 2,
                }}>
                  ⚡ {v.safety_pathway}
                </div>
              )}

              {/* Transcript excerpt */}
              {v.transcript_excerpt && (
                <div style={{
                  background: `${vColor}0d`,
                  border: `1px solid ${vColor}33`,
                  borderLeft: `3px solid ${vColor}`,
                  borderRadius: "0 6px 6px 0",
                  padding: "7px 12px",
                  fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
                  color: "#ffa657", fontStyle: "italic", lineHeight: 1.6,
                }}>
                  "{v.transcript_excerpt}"
                </div>
              )}
            </div>
          );
        };

        return (
          <div style={{ padding: "14px 16px 0" }}>
            {/* Advisory tooltip icon */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <SectionLabel>Analysis</SectionLabel>
              <span
                title="Advisory — transcription may be imperfect and feeds are often one-sided."
                style={{
                  fontSize: 11, color: "#484f58", cursor: "help",
                  userSelect: "none" as const, marginTop: -8, flexShrink: 0,
                }}
              >
                ⓘ
              </span>
            </div>

            {/* Phraseology Notes subsection */}
            {phraseologyNotes.length > 0 && (
              <div style={{ marginBottom: situationalEvents.length > 0 ? 18 : 0 }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: "#44aaff",
                  letterSpacing: 1.1, textTransform: "uppercase" as const,
                  borderLeft: "3px solid #44aaff44", paddingLeft: 8,
                  marginBottom: 10,
                }}>
                  Phraseology Notes
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {phraseologyNotes.map((v, i) => renderObservation(v, i, phraseologyNotes))}
                </div>
              </div>
            )}

            {/* Situational Events subsection */}
            {situationalEvents.length > 0 && (
              <div>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: "#8b949e",
                  letterSpacing: 1.1, textTransform: "uppercase" as const,
                  borderLeft: "3px solid #30363d", paddingLeft: 8,
                  marginBottom: 10,
                }}>
                  Situational Events
                </div>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  {situationalEvents.map((v, i) => renderObservation(v, i, situationalEvents))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* ── 4. REVIEW GUIDANCE ── */}
      <div style={{ padding: "14px 16px 10px" }}>
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 12,
          background: `${borderColor}18`,
          border: `1px solid ${borderColor}55`,
          borderRadius: 6, padding: "12px 14px",
        }}>
          <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1, paddingTop: 1 }}>{icon}</span>
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: 10, fontWeight: 700, color: borderColor,
              letterSpacing: 1.2, textTransform: "uppercase" as const, marginBottom: 4,
            }}>
              Review Guidance
            </div>
            <p style={{ fontSize: 13, color: "#e6edf3", margin: 0, lineHeight: 1.55, fontWeight: 500 }}>
              {ACTION_REQUIRED[severity] ?? "Document and review this observation."}
            </p>
          </div>
        </div>
      </div>

      {/* ── 5. REVIEW ── */}
      <div style={{
        margin: "0 16px 14px",
        background: "#0d1117", border: "1px solid #21262d",
        borderRadius: 6, padding: "10px 12px",
        display: "flex", flexDirection: "column" as const, gap: 12,
      }}>
        <StatusWorkflow resultId={r.id} initial={r.status} />
        <ReviewerNotes resultId={r.id} initial={r.reviewer_notes} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => {
              const text = buildReportText(r, callsign);
              navigator.clipboard.writeText(text).then(() => {
                setReportCopied(true);
                setTimeout(() => setReportCopied(false), 2500);
              });
            }}
            style={{
              fontSize: 10, color: "#8b949e", background: "none",
              border: "1px solid #30363d", borderRadius: 4,
              padding: "3px 10px", cursor: "pointer", fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            <span>{reportCopied ? "✓" : "⎘"}</span>
            {reportCopied ? "Copied to clipboard" : "Copy study sheet"}
          </button>
          <span style={{ fontSize: 10, color: "#3a3f47", fontStyle: "italic" }}>
            Paste into your review system
          </span>
        </div>
      </div>

    </div>
  );
}

// ─── UnassessableCard ─────────────────────────────────────────────────────────
function UnassessableCard({ r }: { r: AnalysisResult }) {
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
      style={{
        background: "#0d1117",
        border: "1px solid #21262d",
        borderLeft: "3px solid #3a3f47",
        borderRadius: 8, overflow: "hidden", cursor: "pointer",
      }}
      onClick={() => setExpanded(v => !v)}
    >
      {/* Collapsed header — mirrors CompliantCard structure */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "9px 14px", flexWrap: "wrap" as const,
      }}>
        <span style={{
          background: "#21262d", color: "#6e7681",
          padding: "2px 9px", borderRadius: 12,
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5, flexShrink: 0,
        }}>
          UNASSESSABLE
        </span>
        <span style={{
          background: "#161b22", color: "#6e7681",
          padding: "2px 7px", borderRadius: 4, fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {r.airport_code}
        </span>
        <span style={{ flex: 1 }} />
        {confPct !== null && (
          <span style={{
            fontSize: 10, color: "#484f58",
            background: "#161b22", border: "1px solid #21262d",
            borderRadius: 4, padding: "1px 6px", flexShrink: 0,
          }}>
            STT {confPct}%
          </span>
        )}
        <span style={{ fontSize: 11, color: "#3a3f47", whiteSpace: "nowrap" as const }}>{ago}</span>
        <span style={{ fontSize: 10, color: "#3a3f47" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {/* Expanded: full reason + transcript for spot-checking */}
      {expanded && (
        <div
          style={{ borderTop: "1px solid #21262d" }}
          onClick={e => e.stopPropagation()}
        >
          {/* Full reason paragraph */}
          {r.summary && (
            <div style={{ padding: "10px 14px 0" }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: "#484f58",
                letterSpacing: 1.2, textTransform: "uppercase" as const, marginBottom: 5,
              }}>
                Reason
              </div>
              <p style={{
                fontSize: 12, color: "#6e7681", margin: 0,
                lineHeight: 1.7, fontStyle: "italic",
              }}>
                {r.summary}
              </p>
            </div>
          )}

          <div style={{ padding: "10px 14px 4px" }}>
            <div style={{
              fontSize: 9, fontWeight: 700, color: "#484f58",
              letterSpacing: 1.2, textTransform: "uppercase" as const, marginBottom: 6,
            }}>
              Raw Transcript (for manual review)
            </div>
            <div style={{
              background: "#161b22", border: "1px solid #21262d", borderRadius: 6,
              padding: "10px 14px",
              fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
              color: "#6e7681", lineHeight: 1.75, whiteSpace: "pre-wrap" as const,
            }}>
              {r.transcript || "— no readable text recovered —"}
            </div>
          </div>
          <div style={{ padding: "6px 14px 12px" }}>
            <p style={{ fontSize: 11, color: "#484f58", margin: 0, fontStyle: "italic" }}>
              This transmission was excluded from phraseology rate calculations.
            </p>
          </div>
          <div style={{
            margin: "0 14px 12px",
            background: "#0d1117", border: "1px solid #21262d",
            borderRadius: 6, padding: "8px 10px",
          }}>
            <StatusWorkflow resultId={r.id} initial={r.status} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ResultCard — routes to the right component ──────────────────────────────
const ResultCard = React.memo(function ResultCard({ r, priorOccurrences, lastSeenAgo }: {
  r: AnalysisResult;
  priorOccurrences?: number;
  lastSeenAgo?: string | null;
}) {
  const severity = getCardSeverity(r);
  if (severity === "unassessable") return <UnassessableCard r={r} />;
  if (severity === "standard") return <CompliantCard r={r} />;
  return <ObservationCard r={r} priorOccurrences={priorOccurrences} lastSeenAgo={lastSeenAgo} />;
});

// ─── LiveFeed ─────────────────────────────────────────────────────────────────
interface Props {
  results: AnalysisResult[];
  filter: Filter;
  airportFilter: string;
  isRunning?: boolean;
  pipelineStatus?: PipelineStatusSummary | null;
  apiError?: string | null;
}

function emptyMessage(
  results: AnalysisResult[],
  isRunning?: boolean,
  pipelineStatus?: PipelineStatusSummary | null,
  apiError?: string | null,
): string {
  if (apiError) return "Unable to load analysis cards. Check the pipeline status above.";
  if (results.length > 0) return "No results match this filter.";
  if (!isRunning) return "Start monitoring to collect ATC transcripts.";
  if (pipelineStatus?.last_gemini_error) return "Gemini is unavailable. Captured transcripts will appear as review cards after the batch fallback persists.";
  if ((pipelineStatus?.queued_transcripts ?? 0) > 0) return "Transcripts are queued and waiting for the next Gemini batch.";
  if (pipelineStatus?.last_audio_at) return "Audio is connected. Waiting for a readable ATC transmission.";
  return "Connecting to live ATC feeds...";
}

export function LiveFeed({ results, filter, airportFilter, isRunning, pipelineStatus, apiError }: Props) {
  // Build callsign occurrence index (results ordered newest-first)
  // For each result, compute how many OLDER results share the same callsign
  const callsignIndex = React.useMemo(() => {
    const index = new Map<string, number[]>(); // callsign → indices in results[]
    results.forEach((r, i) => {
      const cs = r.enrichment?.callsign_detected ?? extractCallsign(r.transcript).callsign;
      if (!cs) return;
      if (!index.has(cs)) index.set(cs, []);
      index.get(cs)!.push(i);
    });
    return index;
  }, [results]);

  const filtered = results.filter(r => {
    if (filter !== "all" && getCardSeverity(r) !== filter) return false;
    if (airportFilter !== "all" && r.airport_code !== airportFilter) return false;
    return true;
  });

  return (
    <div>
      {filtered.length === 0 && (
        <div style={{
          color: "#8b949e",
          textAlign: "center" as const,
          margin: "40px auto",
          maxWidth: 460,
          border: "1px dashed #30363d",
          borderRadius: 8,
          padding: "22px 20px",
          background: "#0d1117",
        }}>
          <div style={{ fontSize: 14, color: "#c9d1d9", marginBottom: 6 }}>
            {emptyMessage(results, isRunning, pipelineStatus, apiError)}
          </div>
          {isRunning && results.length === 0 && (
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              The analyzer batches transcripts before creating cards, so live audio can lead visible results by several minutes.
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {filtered.map((r, filteredIdx) => {
          // Find global index in results[]
          const globalIdx = results.indexOf(r);
          const cs = r.enrichment?.callsign_detected ?? extractCallsign(r.transcript).callsign;
          let priorOccurrences = 0;
          let lastSeenAgo: string | null = null;
          if (cs) {
            const allIdx = callsignIndex.get(cs) ?? [];
            // Prior = older (higher index, since results sorted newest-first)
            const priorIdx = allIdx.filter(i => i > globalIdx);
            priorOccurrences = priorIdx.length;
            if (priorIdx.length > 0) {
              const prevR = results[priorIdx[0]];
              lastSeenAgo = formatDistanceToNow(
                new Date(prevR.timestamp.endsWith("Z") ? prevR.timestamp : prevR.timestamp + "Z"),
                { addSuffix: true }
              );
            }
          }
          return (
            <ResultCard
              key={r.id ?? `${r.airport_code}-${r.timestamp}`}
              r={r}
              priorOccurrences={priorOccurrences}
              lastSeenAgo={lastSeenAgo}
            />
          );
        })}
      </div>
    </div>
  );
}
