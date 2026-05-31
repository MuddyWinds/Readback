import type { Enrichment, Observation, SpeakerSegment } from "./types";
import { normalizeCallsign } from "./callsign";
import { extractCallsign } from "./transcript";

export const UNATTRIBUTED = "__unattributed__";

export interface CallsignGroup {
  key: string;                 // normalized callsign, or UNATTRIBUTED
  callsign: string | null;     // raw display callsign (first occurrence), or null
  segments: SpeakerSegment[];
  observations: Observation[];
}

/**
 * Group a chunk's transcript turns + observations by aircraft.
 * - Attributed groups are ordered by first appearance in speaker_segments
 *   (then by first appearance in observations for callsigns not seen in segments).
 * - Null/unmatched callsigns collect into a single trailing UNATTRIBUTED group.
 * - Legacy rows (no callsign on any segment or observation) fall back to one
 *   group keyed by the regex callsign extracted from the raw transcript.
 */
export function groupByCallsign(
  enrichment: Enrichment | null | undefined,
  observations: Observation[],
  rawTranscript: string,
): CallsignGroup[] {
  const segments = enrichment?.speaker_segments ?? [];
  const obs = observations ?? [];

  const anyAttributed =
    segments.some(s => s.callsign != null && s.callsign !== "") ||
    obs.some(o => o.callsign != null && o.callsign !== "");

  if (!anyAttributed) {
    // Preserve today's single-callsign behavior: prefer the Gemini-enriched
    // callsign_detected, then fall back to a regex extraction from the raw
    // transcript. (ObservationCard's card-level primary picks enrichment first
    // too — the legacy group key must match.)
    const raw = enrichment?.callsign_detected ?? extractCallsign(rawTranscript).callsign;
    const key = normalizeCallsign(raw) ?? UNATTRIBUTED;
    return [{ key, callsign: raw ?? null, segments, observations: obs }];
  }

  const order: string[] = [];
  const groups = new Map<string, CallsignGroup>();

  const ensure = (rawCs: string | null | undefined): CallsignGroup => {
    const key = normalizeCallsign(rawCs ?? undefined) ?? UNATTRIBUTED;
    let g = groups.get(key);
    if (!g) {
      g = { key, callsign: key === UNATTRIBUTED ? null : (rawCs ?? null), segments: [], observations: [] };
      groups.set(key, g);
      order.push(key);
    } else if (g.callsign == null && key !== UNATTRIBUTED && rawCs) {
      g.callsign = rawCs;
    }
    return g;
  };

  for (const s of segments) ensure(s.callsign).segments.push(s);
  for (const o of obs) ensure(o.callsign).observations.push(o);

  // UNATTRIBUTED always last
  const ordered = order
    .filter(k => k !== UNATTRIBUTED)
    .map(k => groups.get(k)!);
  if (groups.has(UNATTRIBUTED)) ordered.push(groups.get(UNATTRIBUTED)!);
  return ordered;
}
