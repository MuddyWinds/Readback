import React, { useState, useEffect } from "react";
import { formatDistanceToNow } from "date-fns";
import { useSettings } from "../../SettingsContext";
import { getCardSeverity, SEV_ORDER, type Severity } from "../../lib/severity";
import { useAdsb, useAdsbSnapshot, useHazards, useUpdateResult } from "../../lib/queries";

export interface SpeakerSegment { role: "ATC" | "PILOT" | "UNKNOWN"; text: string; }

export interface Enrichment {
  speaker_segments:     SpeakerSegment[];
  atc_instruction:      string | null;
  pilot_readback:       string | null;
  readback_correct:     boolean | null;
  readback_discrepancy: string | null;
  callsign_detected:    string | null;
  callsign_clarity:     number; // 0-100
}

export type ObservationKind = "phraseology_note" | "situational_event";

export interface Observation {
  kind: ObservationKind;
  note_type: string;
  hfacs_level: string;
  significance: "low" | "medium" | "high" | "critical";
  description: string;
  safety_pathway?: string | null;
  relevant_regulation?: string | null;
  transcript_excerpt?: string | null;
}

export interface AnalysisResult {
  id?: number;
  timestamp: string;
  airport_code: string;
  transcript: string;
  assessable?: boolean;
  assessable_confidence?: number;
  is_standard: boolean;
  observations: Observation[];
  summary: string;
  confidence_score: number;
  enrichment?: Enrichment | null;
  status?: string;
  reviewer_notes?: string;
}

export type Filter = "all" | "standard" | "low" | "medium" | "high" | "critical" | "unassessable";
export type GroupBy = "none" | "airport";
export { getCardSeverity, SEV_ORDER, type Severity } from "../../lib/severity";

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
const SEV_LABEL: Record<Severity, string> = {
  standard: "STANDARD", low: "LOW", medium: "MEDIUM", high: "HIGH", critical: "CRITICAL",
  unassessable: "UNASSESSABLE",
};
const SEV_ICON: Record<string, string> = {
  critical: "🚨", high: "⚠️", medium: "📋", low: "📝", unassessable: "◌",
};
const ACTION_REQUIRED: Record<string, string> = {
  critical: "Treat as a high-priority study item. Verify the transcript, review the context, and avoid drawing operational conclusions from this tool alone.",
  high:     "Verify the transcript and supporting context before using this as a training or research example.",
  medium:   "Save for review and compare against standard phraseology when studying the session.",
  low:      "Log as a low-priority learning note. No operational action is implied.",
};
const SEV_COLOR: Record<string, string> = {
  critical: "#ff4444", high: "#ff8800", medium: "#e3b341", low: "#44aaff", unassessable: "#484f58",
};
const HFACS_PLAIN: Record<string, string> = {
  "Unsafe Act":               "Front-line action or communication choice",
  "Precondition":             "Environmental or physiological condition that enabled the error",
  "Unsafe Supervision":       "Supervisory or task-management context",
  "Organizational Influence": "Policy, culture, or resource context",
};

function extractActions(transcript: string): string[] {
  const t = transcript.toLowerCase();
  const actions: string[] = [];
  if (/climb (and maintain|to|via)/.test(t)) actions.push("CLIMB");
  if (/descend (and maintain|to|via)/.test(t)) actions.push("DESCEND");
  if (/cleared (for )?takeoff/.test(t)) actions.push("TAKEOFF");
  if (/cleared (to )?land/.test(t)) actions.push("LANDING");
  if (/go.?around/.test(t)) actions.push("GO AROUND");
  if (/hold/.test(t)) actions.push("HOLD");
  if (/mayday|pan pan/.test(t)) actions.push("EMERGENCY");
  if (/turn (left|right)/.test(t)) actions.push("TURN");
  if (/speed/.test(t)) actions.push("SPEED");
  if (/contact|frequency/.test(t)) actions.push("FREQ CHANGE");
  if (/pushback/.test(t)) actions.push("PUSHBACK");
  if (/taxi/.test(t)) actions.push("TAXI");
  return actions;
}

// ── Phonetic callsign extraction ──────────────────────────────────────────────

const PHONETIC_DIGIT: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9", niner: "9",
};
const AIRLINE_ICAO: Record<string, string> = {
  delta: "DAL", american: "AAL", united: "UAL", southwest: "SWA",
  jetblue: "JBU", alaska: "ASA", spirit: "NKS", frontier: "FFT",
  allegiant: "AAY", lufthansa: "DLH", british: "BAW", cathay: "CPA",
  emirates: "UAE", singapore: "SIA", qantas: "QFA", air: "ACA",
  continental: "COA", expressjet: "SKW", envoy: "ENY", skywest: "SKW",
};
const CALLSIGN_REGEX = /\b([A-Z]{2,3}\d{1,4}[A-Z]?|N\d{4,5}[A-Z]{0,2})\b/;

/** Expand phonetic ATC speech to standard callsign format before regex matching. */
function phoneticExpand(t: string): string {
  let out = t.toLowerCase();
  // Replace airline names with ICAO prefix
  for (const [name, icao] of Object.entries(AIRLINE_ICAO)) {
    out = out.replace(new RegExp(`\\b${name}\\b`, "g"), icao);
  }
  // Replace number words with digits (repeated passes for sequences)
  for (const [word, digit] of Object.entries(PHONETIC_DIGIT)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, "g"), digit);
  }
  // Remove spaces between uppercase letters/digits that look like a callsign
  out = out.replace(/([A-Z]{2,3})\s+(\d[\d\s]*\d|\d)/gi, (_, prefix, nums) =>
    prefix.toUpperCase() + nums.replace(/\s/g, "")
  );
  return out.toUpperCase();
}

/** Extract callsign — tries direct regex first, then phonetic expansion. */
function extractCallsign(transcript: string): { callsign: string | null; confidence: "high" | "low" } {
  const direct = transcript.toUpperCase().match(CALLSIGN_REGEX);
  if (direct) return { callsign: direct[1], confidence: "high" };
  const expanded = phoneticExpand(transcript).match(CALLSIGN_REGEX);
  if (expanded) return { callsign: expanded[1], confidence: "low" };
  return { callsign: null, confidence: "low" };
}

// ── ASR artifact detection ────────────────────────────────────────────────────
/** Normalise a string to bare digits for comparison (strips NATO phonetics + spaces). */
function normalizeNumeric(s: string): string {
  return s
    .replace(/\bniner\b/gi, "9").replace(/\btree\b/gi, "3")
    .replace(/\bfife\b/gi, "5").replace(/\bzero\b/gi, "0")
    .replace(/\bone\b/gi, "1").replace(/\btwo\b/gi, "2")
    .replace(/\bfour\b/gi, "4").replace(/\bsix\b/gi, "6")
    .replace(/\bseven\b/gi, "7").replace(/\beight\b/gi, "8")
    .replace(/[^0-9A-Z]/gi, "").toUpperCase();
}

/** Returns true if the discrepancy is plausibly an ASR noise artefact rather than a real error. */
function isAsrAmbiguous(atcInstr: string | null, pilotReadback: string | null): boolean {
  if (!atcInstr || !pilotReadback) return false;
  const a = normalizeNumeric(atcInstr);
  const b = normalizeNumeric(pilotReadback);
  if (a === b) return true;
  // Leading "4" prefix insertion (ASR commonly prepends "four")
  if (a.replace(/^4/, "") === b || b.replace(/^4/, "") === a) return true;
  // Single-digit difference in a ≥3-char sequence
  if (a.length === b.length && a.length >= 3) {
    let diffs = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diffs++;
    if (diffs <= 1) return true;
  }
  return false;
}

// ── Module-level watch list (reactive across all card instances) ──────────────
const _watchListeners = new Set<() => void>();
function _getWatchSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem("atc_watchlist") || "[]")); }
  catch { return new Set(); }
}
function useWatchList(): [Set<string>, (cs: string) => void] {
  const [list, setList] = React.useState<Set<string>>(_getWatchSet);
  React.useEffect(() => {
    const upd = () => setList(new Set(_getWatchSet()));
    _watchListeners.add(upd);
    return () => { _watchListeners.delete(upd); };
  }, []);
  const toggle = React.useCallback((cs: string) => {
    const next = _getWatchSet();
    if (next.has(cs)) next.delete(cs); else next.add(cs);
    localStorage.setItem("atc_watchlist", JSON.stringify(Array.from(next)));
    _watchListeners.forEach(fn => fn());
  }, []);
  return [list, toggle];
}

const ACTION_COLOR: Record<string, string> = {
  CLIMB: "#3fb950", DESCEND: "#58a6ff", TAKEOFF: "#d2a8ff", LANDING: "#79c0ff",
  "GO AROUND": "#ff7b72", HOLD: "#e3b341", EMERGENCY: "#ff4444", TURN: "#a5d6ff",
  SPEED: "#ffa657", "FREQ CHANGE": "#8b949e", PUSHBACK: "#bc8cff", TAXI: "#c9d1d9",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 700, color: "#484f58",
      letterSpacing: 1.3, textTransform: "uppercase" as const, marginBottom: 8,
    }}>
      {children}
    </div>
  );
}

/** Semantic confidence label — replaces bare "AI 73%" with meaningful tier. */
function ConfidenceBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tier =
    pct >= 75 ? { label: "RELIABLE",   color: "#3fb950", bg: "#3fb95018" } :
    pct >= 50 ? { label: "VERIFY",     color: "#e3b341", bg: "#e3b34118" } :
                { label: "UNRELIABLE", color: "#ff4444", bg: "#ff444418" };
  return (
    <span
      title={`AI confidence: ${pct}% — ${
        pct >= 75 ? "verdict is well-supported" :
        pct >= 50 ? "manually verify this transcript before acting" :
                    "low confidence — treat as indicative only"
      }`}
      style={{
        fontSize: 10, fontWeight: 700,
        color: tier.color, background: tier.bg,
        border: `1px solid ${tier.color}44`,
        borderRadius: 4, padding: "1px 6px",
        whiteSpace: "nowrap", cursor: "help",
      }}
    >
      {pct >= 75 ? "" : "⚠ "}{tier.label} {pct}%
    </span>
  );
}

/** Structured transcript: speaker-labelled turns, readback comparison. */
function StructuredTranscript({
  enrichment, rawTranscript, borderColor, assessableConfidence,
}: { enrichment: Enrichment | null | undefined; rawTranscript: string; borderColor: string; assessableConfidence?: number }) {
  const segs = enrichment?.speaker_segments;
  const hasStructure = segs && segs.length > 0 && segs.some(s => s.role !== "UNKNOWN");

  if (!hasStructure) {
    return (
      <div style={{
        background: "#0d1117", borderRadius: 6, padding: "12px 14px",
        fontSize: 12, fontFamily: "'SF Mono', 'Fira Code', monospace",
        color: "#8b949e", lineHeight: 1.75, whiteSpace: "pre-wrap" as const,
      }}>
        {rawTranscript}
      </div>
    );
  }

  const roleColor = { ATC: "#58a6ff", PILOT: "#3fb950", UNKNOWN: "#6e7681" };
  const roleLabel = { ATC: "ATC", PILOT: "PIL", UNKNOWN: "???" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {segs!.map((seg, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: 0.8,
            color: roleColor[seg.role],
            background: roleColor[seg.role] + "18",
            border: `1px solid ${roleColor[seg.role]}44`,
            borderRadius: 3, padding: "2px 5px",
            flexShrink: 0, marginTop: 1, fontFamily: "monospace",
          }}>
            {roleLabel[seg.role]}
          </span>
          <span style={{
            fontSize: 12, fontFamily: "'SF Mono','Fira Code',monospace",
            color: "#8b949e", lineHeight: 1.7,
          }}>
            {seg.text}
          </span>
        </div>
      ))}

      {/* Readback comparison block */}
      {enrichment?.readback_correct === false && enrichment.readback_discrepancy && (() => {
        const lowConfidence = (assessableConfidence ?? 1) < 0.6;
        const asrAmbig = isAsrAmbiguous(enrichment.atc_instruction, enrichment.pilot_readback);
        if (lowConfidence) {
          return (
            <div style={{ marginTop: 6, background: "#21262d", borderRadius: 6, padding: "7px 12px" }}>
              <span style={{ fontSize: 10, color: "#484f58", fontStyle: "italic" }}>
                ⚠ Transcript quality insufficient to verify readback — manual review required.
              </span>
            </div>
          );
        }
        return (
          <div style={{
            marginTop: 6,
            background: asrAmbig ? "#e3b34112" : "#ff444412",
            border: `1px solid ${asrAmbig ? "#e3b34144" : "#ff444444"}`,
            borderLeft: `3px solid ${asrAmbig ? "#e3b341" : "#ff4444"}`,
            borderRadius: "0 6px 6px 0", padding: "8px 12px",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: asrAmbig ? "#e3b341" : "#ff4444", letterSpacing: 1, marginBottom: 4 }}>
              {asrAmbig ? "POSSIBLE ASR ARTEFACT — VERIFY MANUALLY" : "READBACK DISCREPANCY DETECTED"}
            </div>
            {enrichment.atc_instruction && (
              <div style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 10, color: "#58a6ff", fontWeight: 700, minWidth: 50 }}>ATC:</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: "#c9d1d9" }}>{enrichment.atc_instruction}</span>
              </div>
            )}
            {enrichment.pilot_readback && (
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "#3fb950", fontWeight: 700, minWidth: 50 }}>Pilot:</span>
                <span style={{ fontSize: 11, fontFamily: "monospace", color: asrAmbig ? "#e3b341" : "#ff8800" }}>{enrichment.pilot_readback}</span>
              </div>
            )}
            <div style={{ fontSize: 11, color: asrAmbig ? "#e3b341" : "#ff8800" }}>{enrichment.readback_discrepancy}</div>
            {asrAmbig && (
              <div style={{ fontSize: 10, color: "#484f58", marginTop: 4, fontStyle: "italic" }}>
                Values normalise to the same number after removing ASR phonetic substitutions — likely not a true error.
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}

/**
 * Truncate a regulation citation to chapter level for display.
 * Examples:
 *   "ICAO Annex 2, Chapter 3, Section 3.2.1" → "ICAO Annex 2, Chapter 3"
 *   "FAA Order 7110.65, Chapter 2, Section 2-1-3" → "FAA Order 7110.65, Chapter 2"
 *   "14 CFR 91.123" → "14 CFR 91.123"  (already short, shown as-is)
 * Full string always available on hover via title attribute.
 */
/**
 * Truncate a regulation citation to chapter level for display.
 * Cuts at "Section", "Para", "§", or sub-section numbers (e.g. "8.3.1").
 * The comma before the divider is optional.
 * Full string always available on hover via title attribute.
 */
function truncateAtChapter(reg: string): string {
  const cut = reg.search(/,?\s*(Section|Para(graph)?|§|\d+\.\d+\.\d+)\b/i);
  return cut > 0 ? reg.slice(0, cut).trim() : reg;
}

/** Extract the base document name — everything before the first comma. */
function toDocName(reg: string): string {
  const i = reg.indexOf(",");
  return i > 0 ? reg.slice(0, i).trim() : reg.trim();
}

/** Inline regulation badge for a single observation. Truncates at chapter level; hover shows full citation. */
function RegBadge({ regulation }: { regulation: string }) {
  if (!regulation) return null;
  const display = truncateAtChapter(regulation);
  return (
    <span
      title={regulation}
      style={{
        fontSize: 10, fontFamily: "monospace", color: "#c9d1d9",
        background: "#21262d", border: "1px solid #30363d",
        padding: "2px 8px", borderRadius: 4,
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        maxWidth: 220, display: "inline-block", verticalAlign: "middle",
        cursor: "help", flexShrink: 1, minWidth: 0,
      }}
    >
      {display}
    </span>
  );
}

function parseBullets(summary: string): string[] {
  return summary
    .split(/(?<=[.!?])\s+/)
    .map(s => s.replace(/[.!?]+$/, "").trim())
    .filter(s => s.length > 8);
}

// ── Review workflow ───────────────────────────────────────────────────────────

type ReviewStatus = "new" | "under_review" | "confirmed" | "false_positive";
const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "NEW", under_review: "REVIEWING", confirmed: "CONFIRMED",
  false_positive: "FALSE +VE",
};
const STATUS_COLOR: Record<ReviewStatus, string> = {
  new: "#484f58", under_review: "#e3b341", confirmed: "#ff4444",
  false_positive: "#3fb950",
};

function StatusWorkflow({ resultId, initial }: { resultId?: number; initial?: string }) {
  const [status, setStatus] = React.useState<ReviewStatus>((initial || "new") as ReviewStatus);
  const [saving, setSaving] = React.useState(false);
  const updateResult = useUpdateResult();
  const change = async (s: ReviewStatus) => {
    setStatus(s);
    if (!resultId) return;
    setSaving(true);
    try {
      await updateResult.mutateAsync({ id: resultId, patch: { status: s } });
    } finally { setSaving(false); }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" as const }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: "#484f58", letterSpacing: 0.8, marginRight: 2 }}>STATUS</span>
      {(["new", "under_review", "confirmed", "false_positive"] as ReviewStatus[]).map(s => (
        <button key={s} onClick={() => change(s)} style={{
          fontSize: 9, fontWeight: 700, letterSpacing: 0.3,
          padding: "2px 7px", borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
          background: status === s ? STATUS_COLOR[s] + "22" : "transparent",
          border: `1px solid ${status === s ? STATUS_COLOR[s] : "#30363d"}`,
          color: status === s ? STATUS_COLOR[s] : "#484f58",
          transition: "all 0.12s",
        }}>
          {STATUS_LABEL[s]}
        </button>
      ))}
      {saving && <span style={{ fontSize: 9, color: "#484f58" }}>saving…</span>}
    </div>
  );
}

function ReviewerNotes({ resultId, initial }: { resultId?: number; initial?: string }) {
  const [notes, setNotes] = React.useState(initial ?? "");
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const updateResult = useUpdateResult();
  const save = async () => {
    setSaving(true);
    try {
      if (resultId) {
        await updateResult.mutateAsync({ id: resultId, patch: { reviewer_notes: notes } });
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
        <SectionLabel>Reviewer Notes</SectionLabel>
        {!editing && (
          <button onClick={() => setEditing(true)} style={{
            fontSize: 10, color: "#58a6ff", background: "none", border: "none",
            cursor: "pointer", padding: 0, marginTop: -8,
          }}>
            {notes ? "Edit" : "+ Add note"}
          </button>
        )}
      </div>
      {editing ? (
        <div>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            autoFocus
            style={{
              width: "100%", background: "#161b22", border: "1px solid #30363d",
              borderRadius: 6, color: "#e6edf3", fontSize: 12, padding: "8px 10px",
              fontFamily: "inherit", lineHeight: 1.6, resize: "vertical" as const,
              minHeight: 64, boxSizing: "border-box" as const,
            }}
            placeholder="Review notes, transcript caveats, study context…"
          />
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <button onClick={save} disabled={saving} style={{
              fontSize: 11, color: "#fff", background: "#238636",
              border: "1px solid #2ea043", borderRadius: 4,
              padding: "3px 12px", cursor: "pointer", fontFamily: "inherit",
            }}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => { setNotes(initial ?? ""); setEditing(false); }} style={{
              fontSize: 11, color: "#8b949e", background: "none",
              border: "1px solid #30363d", borderRadius: 4,
              padding: "3px 10px", cursor: "pointer", fontFamily: "inherit",
            }}>
              Cancel
            </button>
          </div>
        </div>
      ) : notes ? (
        <p style={{ fontSize: 12, color: "#c9d1d9", margin: 0, lineHeight: 1.65, whiteSpace: "pre-wrap" as const }}>
          {notes}
        </p>
      ) : null}
    </div>
  );
}

/** Generate a plain-text study sheet for copy-paste into a formal system. */
function buildReportText(r: AnalysisResult, callsign: string | null): string {
  const ts = r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z";
  const sev = getCardSeverity(r).toUpperCase();
  const lines = [
    "═══════════════════════════════════════════════",
    "        ATC PHRASEOLOGY STUDY SHEET (DRAFT)",
    "═══════════════════════════════════════════════",
    `Generated:    ${new Date().toUTCString()}`,
    `Airport:      ${r.airport_code}`,
    `Event Time:   ${ts}`,
    `Callsign:     ${callsign ?? "Unknown"}`,
    `Significance: ${sev}`,
    "",
    "── SUMMARY ─────────────────────────────────────",
    r.summary || "(no summary available)",
    "",
  ];
  if (r.observations?.length) {
    lines.push("── OBSERVATIONS ────────────────────────────────");
    r.observations.forEach((v, i) => {
      lines.push(`${i + 1}. [${(v.significance ?? "").toUpperCase()}] ${v.note_type}`);
      lines.push(`   Regulation : ${v.relevant_regulation ?? "—"}`);
      lines.push(`   HFACS      : ${v.hfacs_level ?? "—"}`);
      lines.push(`   Description: ${v.description}`);
      if (v.safety_pathway) lines.push(`   Risk path  : ${v.safety_pathway}`);
      if (v.transcript_excerpt) lines.push(`   Excerpt    : "${v.transcript_excerpt}"`);
      lines.push("");
    });
  }
  lines.push("── TRANSCRIPT ──────────────────────────────────");
  lines.push(r.transcript);
  lines.push("");
  lines.push("── REVIEWER NOTES ──────────────────────────────");
  lines.push(r.reviewer_notes || "(add review notes here)");
  lines.push("═══════════════════════════════════════════════");
  return lines.join("\n");
}

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

function isActiveAt(from: string | null, to: string | null, ts: string): boolean {
  const t = new Date(ts.endsWith("Z") ? ts : ts + "Z").getTime();
  const f = from ? new Date(from).getTime() : 0;
  const e = to   ? new Date(to).getTime()   : Infinity;
  return t >= f && t <= e;
}

/** Banner shown on ObservationCard when met hazards were active at observation time. */
function HazardBanner({ airport, timestamp }: { airport: string; timestamp: string }) {
  const { data: hazards } = useHazards(airport);
  if (!hazards) return null;

  const activeSigmets = (hazards.sigmets ?? []).filter((s: any) => isActiveAt(s.from, s.to, timestamp));
  const activeAirmets = (hazards.airmets ?? []).filter((a: any) => isActiveAt(a.from, a.to, timestamp));
  const recentPireps  = (hazards.pireps  ?? []).filter((p: any) => {
    if (!p.obs_time || (!p.turb && !p.icing)) return false;
    return Math.abs(new Date(timestamp.endsWith("Z") ? timestamp : timestamp + "Z").getTime()
                  - new Date(p.obs_time).getTime()) < 2 * 3_600_000;
  });

  if (!activeSigmets.length && !activeAirmets.length && !recentPireps.length) return null;

  return (
    <div style={{
      padding: "6px 16px", background: "#ff880010",
      borderBottom: "1px solid #ff880030",
      display: "flex", flexDirection: "column", gap: 3,
    }}>
      {activeSigmets.map((s: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#ff4444", background: "#ff444418",
            border: "1px solid #ff444444", borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>SIGMET</span>
          <span style={{ fontSize: 11, color: "#c9d1d9" }}>
            {s.hazard}{s.severity ? ` (${s.severity})` : ""}
            {s.alt_low && s.alt_high ? ` · ${Math.round(s.alt_low/100)*100}–${Math.round(s.alt_high/100)*100} ft` : ""}
          </span>
          <span style={{ fontSize: 10, color: "#484f58", fontStyle: "italic" }}>active at time of transmission</span>
        </div>
      ))}
      {activeAirmets.map((a: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#ff8800", background: "#ff880018",
            border: "1px solid #ff880044", borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>AIRMET</span>
          <span style={{ fontSize: 11, color: "#c9d1d9" }}>{a.hazard}</span>
          <span style={{ fontSize: 10, color: "#484f58", fontStyle: "italic" }}>active at time of transmission</span>
        </div>
      ))}
      {recentPireps.map((p: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#e3b341", background: "#e3b34118",
            border: "1px solid #e3b34144", borderRadius: 3, padding: "1px 5px", flexShrink: 0 }}>PIREP</span>
          <span style={{ fontSize: 11, color: "#c9d1d9" }}>
            {p.turb  ? `Turb: ${p.turb}` : ""}{p.icing ? ` Icing: ${p.icing}` : ""}
            {p.altitude ? ` @ ${p.altitude} ft` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Conflict detection ────────────────────────────────────────────────────────

interface ConflictResult {
  callA: string; callB: string;
  distNm: number; altDiffFt: number;
  level: "SEPARATION LOSS" | "PROXIMITY WARNING";
}

function detectConflicts(aircraft: AdsbAircraft[]): ConflictResult[] {
  const airborne = aircraft.filter(
    a => !a.on_ground && a.latitude != null && a.longitude != null && a.altitude_m != null
  );
  const out: ConflictResult[] = [];
  for (let i = 0; i < airborne.length; i++) {
    for (let j = i + 1; j < airborne.length; j++) {
      const a = airborne[i], b = airborne[j];
      const avgLat  = ((a.latitude! + b.latitude!) / 2) * Math.PI / 180;
      const dlat    = (a.latitude!  - b.latitude!);
      const dlon    = (a.longitude! - b.longitude!) * Math.cos(avgLat);
      const distNm  = Math.sqrt(dlat * dlat + dlon * dlon) * 60;
      const altDiffFt = Math.abs((a.altitude_m! - b.altitude_m!) * 3.281);
      const level = distNm < 5 && altDiffFt < 1000  ? "SEPARATION LOSS"
                  : distNm < 10 && altDiffFt < 2000 ? "PROXIMITY WARNING"
                  : null;
      if (level) out.push({ callA: a.callsign ?? a.icao24, callB: b.callsign ?? b.icao24,
        distNm, altDiffFt, level });
    }
  }
  return out;
}

// ─── ADS-B position snapshot — fetches live data per-airport ──────────────────
interface AdsbAircraft {
  icao24: string; callsign: string | null;
  latitude: number | null; longitude: number | null;
  altitude_m: number | null; on_ground: boolean;
  velocity_ms: number | null; heading: number | null; squawk: string | null;
}
function PositionSnapshot({
  r, callsign, confidence, borderColor,
}: { r: AnalysisResult; callsign: string | null; confidence: "high" | "low"; borderColor: string }) {
  const { geo } = useSettings();
  const snapshot = useAdsbSnapshot(r.id);
  const snapshotData = snapshot.data;
  const shouldFetchLive =
    !r.id || snapshot.isError || Boolean(snapshotData?.error) || (snapshot.isSuccess && !snapshotData?.aircraft);
  const live = useAdsb(shouldFetchLive ? r.airport_code : "");
  const aircraft = (shouldFetchLive ? live.data?.aircraft : snapshotData?.aircraft) as AdsbAircraft[] | null | undefined;
  const loading = (r.id && snapshot.isLoading) || (shouldFetchLive && live.isLoading);
  const err = shouldFetchLive && live.isError ? "Could not fetch ADS-B data" : null;
  const dataSource: "snapshot" | "live" | null = aircraft
    ? (shouldFetchLive ? "live" : "snapshot")
    : null;

  const matched = aircraft?.find(a =>
    callsign && a.callsign && a.callsign.replace(/\s/g, "") === callsign.replace(/\s/g, "")
  ) ?? null;

  // Derive human-readable flight phase from ADS-B state
  const flightPhase = (a: AdsbAircraft): { label: string; detail: string } => {
    const altFt = a.altitude_m != null ? Math.round(a.altitude_m * 3.281) : null;
    const spdKt = a.velocity_ms != null ? Math.round(a.velocity_ms * 1.944) : null;
    const hdg   = a.heading != null ? Math.round(a.heading) : null;
    if (a.on_ground) return { label: "On ground", detail: `Taxiing · ${spdKt != null ? spdKt + " kt" : "—"}` };
    if (altFt == null) return { label: "Airborne", detail: "Altitude unknown" };
    if (altFt < 1000)  return { label: "Final approach / low-level", detail: `${altFt.toLocaleString()} ft · ${spdKt ?? "—"} kt` };
    if (altFt < 5000)  return { label: "Approach / departure", detail: `${altFt.toLocaleString()} ft · ${spdKt ?? "—"} kt · HDG ${hdg ?? "—"}°` };
    if (altFt < 18000) return { label: "Climb / descent", detail: `${altFt.toLocaleString()} ft · ${spdKt ?? "—"} kt` };
    return { label: "En-route", detail: `FL${Math.round(altFt / 100)} · ${spdKt ?? "—"} kt` };
  };

  const distNmFromAirport = (a: AdsbAircraft): number | null => {
    const g = geo[r.airport_code];
    if (!g || a.latitude == null || a.longitude == null) return null;
    const dlat = (a.latitude - g[0]) * 60;
    const dlon = (a.longitude - g[1]) * 60 * Math.cos(g[0] * Math.PI / 180);
    return Math.round(Math.sqrt(dlat*dlat + dlon*dlon) * 10) / 10;
  };

  const fmtAlt = (m: number | null) => m != null ? `${Math.round(m * 3.281).toLocaleString()} ft` : "—";
  const fmtSpd = (ms: number | null) => ms != null ? `${Math.round(ms * 1.944)} kt` : "—";

  return (
    <div style={{
      marginTop: 10,
      background: `${borderColor}08`,
      border: `1px solid ${borderColor}22`,
      borderLeft: `3px solid ${borderColor}`,
      borderRadius: "0 6px 6px 0",
      padding: "10px 14px",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" as const }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: borderColor, letterSpacing: 1.2, textTransform: "uppercase" as const }}>
          Traffic Context
        </span>
        {callsign ? (
          <span style={{ fontSize: 10, fontFamily: "monospace", fontWeight: 700, color: "#e6edf3", background: "#21262d", padding: "1px 7px", borderRadius: 4 }}>
            {callsign}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: "#484f58", fontStyle: "italic" }}>callsign unclear</span>
        )}
        {callsign && confidence === "low" && (
          <span style={{ fontSize: 9, color: "#e3b341", background: "#e3b34118", border: "1px solid #e3b34144", borderRadius: 3, padding: "1px 5px" }}>
            ⚠ phonetic match
          </span>
        )}
        {dataSource && (
          <span style={{ fontSize: 9, color: dataSource === "snapshot" ? "#3fb950" : "#8b949e", background: "#21262d", borderRadius: 3, padding: "1px 6px" }}>
            {dataSource === "snapshot" ? "⏱ at transmission time" : "⚡ current"}
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 10, color: "#484f58", fontFamily: "monospace" }}>
          {new Date(r.timestamp.endsWith("Z") ? r.timestamp : r.timestamp + "Z").toISOString().slice(11, 19)}Z
        </span>
      </div>

      {loading && <p style={{ fontSize: 11, color: "#484f58", margin: 0 }}>Fetching ADS-B…</p>}
      {err    && <p style={{ fontSize: 11, color: "#ff8800", margin: 0 }}>{err}</p>}

      {!loading && !err && aircraft && (() => {
        const airborne  = aircraft.filter(a => !a.on_ground);
        const conflicts = detectConflicts(aircraft);

        // Workload as mitigating-factor context, not just a badge
        const workloadColor = airborne.length >= 15 ? "#ff4444" : airborne.length >= 10 ? "#ff8800" : airborne.length >= 5 ? "#e3b341" : "#3fb950";
        const workloadLabel = airborne.length >= 15 ? "Very high" : airborne.length >= 10 ? "High" : airborne.length >= 5 ? "Moderate" : "Low";

        return (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {/* ── Subject aircraft state ── */}
            {matched ? (
              <div style={{ background: "#161b22", border: "1px solid #21262d", borderRadius: 6, padding: "8px 12px" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#e6edf3" }}>
                    {flightPhase(matched).label}
                  </span>
                  <span style={{ fontSize: 10, color: "#8b949e" }}>
                    {flightPhase(matched).detail}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" as const }}>
                  {[
                    ["Altitude",  fmtAlt(matched.altitude_m)],
                    ["Speed",     fmtSpd(matched.velocity_ms)],
                    ["Heading",   matched.heading != null ? `${Math.round(matched.heading)}°` : "—"],
                    ["Squawk",    matched.squawk ?? "—"],
                    ["Dist from apt", distNmFromAirport(matched) != null ? `${distNmFromAirport(matched)} nm` : "—"],
                  ].map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: 9, color: "#484f58", letterSpacing: 0.5 }}>{label}</div>
                      <div style={{ fontSize: 11, fontFamily: "monospace", color: "#c9d1d9", fontWeight: 600 }}>{val}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : callsign ? (
              <p style={{ fontSize: 11, color: "#6e7681", margin: 0, fontStyle: "italic" }}>
                {callsign} not found in ADS-B data — may have landed, departed, or transponder ID differs.
              </p>
            ) : (
              <p style={{ fontSize: 11, color: "#6e7681", margin: 0, fontStyle: "italic" }}>
                No callsign identified. Cannot correlate with ADS-B.
              </p>
            )}

            {/* ── Sector load — mitigating factor context ── */}
            {airborne.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: workloadColor }} />
                <span style={{ fontSize: 10, color: "#6e7681" }}>
                  Sector load:
                </span>
                <span style={{ fontSize: 10, fontWeight: 700, color: workloadColor }}>
                  {workloadLabel}
                </span>
                <span style={{ fontSize: 10, color: "#484f58" }}>
                  ({airborne.length} airborne · {aircraft.filter(a => a.on_ground).length} ground)
                </span>
                {airborne.length >= 10 && (
                  <span style={{ fontSize: 9, color: "#484f58", fontStyle: "italic" }}>— potential mitigating factor</span>
                )}
              </div>
            )}

            {/* ── Separation alerts ── */}
            {conflicts.map((c, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 6,
                background: c.level === "SEPARATION LOSS" ? "#ff444412" : "#ff880010",
                border: `1px solid ${c.level === "SEPARATION LOSS" ? "#ff444444" : "#ff880030"}`,
                borderRadius: 4, padding: "5px 8px",
              }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: c.level === "SEPARATION LOSS" ? "#ff4444" : "#ff8800", flexShrink: 0 }}>
                  {c.level}
                </span>
                <span style={{ fontSize: 10, fontFamily: "monospace", color: "#c9d1d9" }}>
                  {c.callA} ↔ {c.callB}
                </span>
                <span style={{ fontSize: 10, color: "#6e7681", marginLeft: "auto", whiteSpace: "nowrap" as const }}>
                  {c.distNm.toFixed(1)} nm · Δ{Math.round(c.altDiffFt)} ft
                </span>
              </div>
            ))}
          </div>
        );
      })()}
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
