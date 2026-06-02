/**
 * Callsign normalization shared between ObservationCard, PositionSnapshot,
 * and buildMonitorIndex. Without a single normalization step the same flight
 * appears under several keys (e.g. "AAL123" vs "AAL0123" vs "AAL 123") and
 * the subject-aircraft match in Traffic Context silently fails.
 *
 * Normalization rules (deliberately conservative — we never invent a flight):
 *   - Trim & uppercase.
 *   - Strip internal whitespace and dashes ("AAL 123" → "AAL123").
 *   - Strip leading zeros from a trailing numeric suffix
 *     ("AAL0123" → "AAL123"). Operator codes themselves are preserved.
 *   - N-numbers are pass-through (N123AB stays N123AB; we don't strip the 1).
 */
export function normalizeCallsign(cs: string | null | undefined): string | null {
  if (typeof cs !== "string") return null;
  const trimmed = cs.replace(/[\s-]/g, "").toUpperCase();
  if (!trimmed) return null;

  // N-numbers: leave as-is.
  if (/^N\d/.test(trimmed)) return trimmed;

  // ICAO airline callsign: 3-letter operator + numeric suffix (optional trailing letter).
  // Strip leading zeros from the numeric block only.
  const m = trimmed.match(/^([A-Z]{2,3})0*(\d+)([A-Z]?)$/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;

  return trimmed;
}

// Plausibility patterns (parity with backend/core/callsign.py is_plausible_callsign):
// ICAO operator + numeric block (+ optional trailing letter), or an N-number.
const PLAUSIBLE_ICAO = /^[A-Z]{2,3}\d{1,4}[A-Z]?$/;
const PLAUSIBLE_NNUM = /^N\d{1,5}[A-Z]{0,2}$/;

/**
 * True when a callsign looks real after normalization — i.e. an ICAO airline
 * callsign or an N-number. Used to drop digit-fragment noise (e.g. "273") from
 * finding attribution. Mirrors the backend is_plausible_callsign (R2).
 */
export function isPlausibleCallsign(cs: string | null | undefined): boolean {
  const norm = normalizeCallsign(cs);
  if (!norm) return false;
  return PLAUSIBLE_ICAO.test(norm) || PLAUSIBLE_NNUM.test(norm);
}

/** True when both callsigns normalize to the same key. */
export function callsignsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeCallsign(a);
  const nb = normalizeCallsign(b);
  return na != null && nb != null && na === nb;
}
