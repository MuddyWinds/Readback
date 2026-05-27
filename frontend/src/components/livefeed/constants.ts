import type { Severity } from "../../lib/types";

export type ReviewStatus = "new" | "under_review" | "confirmed" | "false_positive";

export const SEV_LABEL: Record<Severity, string> = {
  standard: "STANDARD", low: "LOW", medium: "MEDIUM", high: "HIGH", critical: "CRITICAL",
  unassessable: "UNASSESSABLE",
};

export const SEV_ICON: Record<string, string> = {
  critical: "🚨", high: "⚠️", medium: "📋", low: "📝", unassessable: "◌",
};

export const ACTION_REQUIRED: Record<string, string> = {
  critical: "Treat as a high-priority study item. Verify the transcript, review the context, and avoid drawing operational conclusions from this tool alone.",
  high:     "Verify the transcript and supporting context before using this as a training or research example.",
  medium:   "Save for review and compare against standard phraseology when studying the session.",
  low:      "Log as a low-priority learning note. No operational action is implied.",
};

export const HFACS_PLAIN: Record<string, string> = {
  "Unsafe Act":               "Front-line action or communication choice",
  "Precondition":             "Environmental or physiological condition that enabled the error",
  "Unsafe Supervision":       "Supervisory or task-management context",
  "Organizational Influence": "Policy, culture, or resource context",
};

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  new: "NEW", under_review: "REVIEWING", confirmed: "CONFIRMED",
  false_positive: "FALSE +VE",
};

// action → theme token name (resolved via var() in CSS, so no hex here)
export const ACTION_TOKEN: Record<string, string> = {
  CLIMB: "--sev-standard", DESCEND: "--accent", TAKEOFF: "--action-takeoff",
  LANDING: "--action-landing", "GO AROUND": "--action-goaround", HOLD: "--sev-medium",
  EMERGENCY: "--sev-critical", TURN: "--action-turn", SPEED: "--action-speed",
  "FREQ CHANGE": "--text-dim", PUSHBACK: "--action-pushback", TAXI: "--action-taxi",
};
