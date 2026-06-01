export const PHONETIC_DIGIT: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9", niner: "9",
};
export const AIRLINE_ICAO: Record<string, string> = {
  delta: "DAL", american: "AAL", united: "UAL", southwest: "SWA",
  jetblue: "JBU", alaska: "ASA", spirit: "NKS", frontier: "FFT",
  allegiant: "AAY", lufthansa: "DLH", british: "BAW", cathay: "CPA",
  emirates: "UAE", singapore: "SIA", qantas: "QFA", air: "ACA",
  continental: "COA", expressjet: "SKW", envoy: "ENY", skywest: "SKW",
};
export const CALLSIGN_REGEX = /\b([A-Z]{2,3}\d{1,4}[A-Z]?|N\d{4,5}[A-Z]{0,2})\b/;

/** Expand phonetic ATC speech to standard callsign format before regex matching. */
export function phoneticExpand(t: string): string {
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
export function extractCallsign(transcript: string): { callsign: string | null; confidence: "high" | "low" } {
  const direct = transcript.toUpperCase().match(CALLSIGN_REGEX);
  if (direct) return { callsign: direct[1], confidence: "high" };
  const expanded = phoneticExpand(transcript).match(CALLSIGN_REGEX);
  if (expanded) return { callsign: expanded[1], confidence: "low" };
  return { callsign: null, confidence: "low" };
}

/** Normalise a string to bare digits for comparison (strips NATO phonetics + spaces). */
export function normalizeNumeric(s: string): string {
  return s
    .replace(/\bniner\b/gi, "9").replace(/\btree\b/gi, "3")
    .replace(/\bfife\b/gi, "5").replace(/\bzero\b/gi, "0")
    .replace(/\bone\b/gi, "1").replace(/\btwo\b/gi, "2")
    .replace(/\bfour\b/gi, "4").replace(/\bsix\b/gi, "6")
    .replace(/\bseven\b/gi, "7").replace(/\beight\b/gi, "8")
    .replace(/[^0-9A-Z]/gi, "").toUpperCase();
}

/** Returns true if the discrepancy is plausibly an ASR noise artefact rather than a real error. */
export function isAsrAmbiguous(atcInstr: string | null, pilotReadback: string | null): boolean {
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

export function extractActions(transcript: string): string[] {
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

export function parseBullets(summary: string): string[] {
  return summary
    .split(/\n|(?<=[.!?])\s+/)
    .map(s => s.replace(/^[-*•]\s+/, "").replace(/[.!?]+$/, "").trim())
    .filter(s => s.length > 8);
}
