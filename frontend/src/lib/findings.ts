import type { Observation } from "./types";
import { SEV_ORDER } from "./severity";
import { normalizeCallsign, isPlausibleCallsign } from "./callsign";

export interface NumberedFinding {
  observation: Observation;
  n: number;
  type: "phraseology_note" | "situational_event";
}

export interface FindingPoint {
  id: number;
  label: string;
  text: string;
  excerpt: string | null;
}

/**
 * Canonical card display order (and numbering source):
 *   phraseology notes first, then situational events,
 *   each sorted by significance descending. Numbered 1..K top-to-bottom.
 */
export function orderedFindings(observations: Observation[]): NumberedFinding[] {
  const bySig = (a: Observation, b: Observation) =>
    (SEV_ORDER[b.significance] ?? 0) - (SEV_ORDER[a.significance] ?? 0);
  const notes = observations.filter(o => o.kind === "phraseology_note").sort(bySig);
  const events = observations.filter(o => o.kind === "situational_event").sort(bySig);
  return [...notes, ...events].map((observation, i) => ({
    observation,
    n: i + 1,
    type: observation.kind as "phraseology_note" | "situational_event",
  }));
}

export function findingPoints(finding: NumberedFinding, firstId = 1): FindingPoint[] {
  const details = (finding.observation.detail_points ?? [])
    .map(p => ({
      text: (p.text ?? "").trim(),
      excerpt: (p.transcript_excerpt ?? null) || null,
    }))
    .filter(p => p.text);

  if (details.length > 0) {
    return details.map((p, i) => ({
      id: firstId + i,
      label: `${finding.n}.${i + 1}`,
      text: p.text,
      excerpt: p.excerpt,
    }));
  }

  return [{
    id: firstId,
    label: String(finding.n),
    text: finding.observation.description,
    excerpt: finding.observation.transcript_excerpt ?? null,
  }];
}

/**
 * Distinct plausible callsigns attributed to the card's *findings* (NOT speaker
 * segments). Drives single- vs multi-aircraft layout. Deduplicates on the
 * normalized form but returns the first raw display callsign seen.
 */
export function attributedCallsigns(observations: Observation[]): string[] {
  const seen = new Map<string, string>(); // normalized key -> first display form
  for (const o of observations) {
    const raw = o.callsign ?? "";
    const norm = normalizeCallsign(raw || undefined);
    if (norm && isPlausibleCallsign(norm) && !seen.has(norm)) {
      seen.set(norm, raw || norm);
    }
  }
  return Array.from(seen.values());
}
