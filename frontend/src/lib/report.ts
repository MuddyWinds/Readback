import { getCardSeverity } from "./severity";
import type { AnalysisResult } from "./types";

/** Generate a plain-text study sheet for copy-paste into a formal system. */
export function buildReportText(r: AnalysisResult, callsign: string | null): string {
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
