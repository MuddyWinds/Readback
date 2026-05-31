from __future__ import annotations

"""
Sends ATC transcripts to Gemini Flash for phraseology analysis.
Uses batch analysis: collects transcripts from all airports over a window,
then sends ONE Gemini call covering all of them — conserving the daily quota.
Produces Observations classified as phraseology notes or situational events.
"""

import asyncio
import json
import re
import time
from datetime import datetime

from google import genai
from google.genai import types

from backend.core.settings_store import current_gemini_key
from backend.models.schemas import AnalysisResult, Observation, KIND_BY_NOTE_TYPE

_client = None
_client_key: str | None = None
_semaphore: asyncio.Semaphore | None = None
_last_call_time: float = 0.0
_MIN_INTERVAL = 12.0  # seconds between calls

def get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(1)
    return _semaphore

def get_client():
    global _client, _client_key
    key = current_gemini_key()
    if _client is None or key != _client_key:
        _client = genai.Client(api_key=key)
        _client_key = key
    return _client


def _missing_analysis_result(item: dict, reason: str) -> AnalysisResult:
    item["analysis_failed"] = True  # Gemini did not return a verdict for this index
    return AnalysisResult(
        timestamp=item["timestamp"],
        airport_code=item["airport_code"],
        transcript=item["transcript"],
        assessable=False,
        assessable_confidence=item.get("stt_confidence", 0.0),
        is_standard=True,
        observations=[],
        summary=reason,
        confidence_score=0.0,
        enrichment={
            "speaker_segments": [],
            "atc_instruction": None,
            "pilot_readback": None,
            "readback_correct": None,
            "readback_discrepancy": None,
            "callsign_detected": None,
            "callsign_clarity": 0,
        },
    )


BATCH_SYSTEM_PROMPT = """You are an expert aviation safety analyst with 20+ years of ATC phraseology
experience across FAA and ICAO regulatory frameworks.

═══════════════════════════════════════════════════════
CRITICAL CONTEXT — READ BEFORE ANALYSING
═══════════════════════════════════════════════════════

1. ONE-SIDED TRANSCRIPTS
   These transcripts may capture only ONE side of a radio exchange
   (controller only, or pilot only). NEVER flag a missing read-back
   or missing response as an observation — the other side may simply
   not have been recorded. Only flag what you can positively
   observe in the text.

2. TRANSCRIPTION NOISE
   This text was produced by an automatic speech recognition model
   from a live radio stream. Expect occasional garbled words,
   mis-heard callsigns, and filler sounds. Do not flag transcription
   artefacts as phraseology errors. If the transcript is too degraded
   to assess reliably, set assessable: false.

   Each transcript header carries stt_conf (0-1), the speech-recognition
   confidence. Low values mean the text may contain more transcription noise —
   weigh this, but readable text with low conf is still assessable. Set
   assessable: false only when the text itself is too garbled to interpret,
   not merely because stt_conf is low.

3. YOUR PRIMARY STANDARD
   Apply the "Reasonable Controller Test": would an experienced,
   qualified controller or pilot, hearing this transmission in a
   normal operational context, understand it completely and act
   correctly without any ambiguity? If YES → standard,
   regardless of whether exact ICAO wording was used.

═══════════════════════════════════════════════════════
WHAT IS NEVER AN OBSERVATION
═══════════════════════════════════════════════════════

Do NOT flag any of the following:

• Pleasantries: "good night", "good day", "bye", "thanks",
  "see you", "have a good one", "good evening"
• Callsign shortening after first contact
  (ICAO Doc 4444 §3.4.1.1 explicitly permits this)
• Minor word-order variation where meaning is unambiguous
  ("Climb to FL120" vs "Climb and maintain FL120" — identical intent)
• Informal affirmations accompanying a correct, complete read-back
  ("Roger, AAL123 cleared to land runway 31L — good day")
• Non-native English phrasing that is grammatically informal
  but operationally unambiguous
• Redundant acknowledgements after a complete read-back
• Standard local/regional conventions universally understood
  at the airport in question
• Readback discrepancies caused by VHF radio / ASR artefacts:
  - A single leading digit inserted before a number sequence
    ("4327" vs "327" — the word "four" is commonly mis-prefixed by ASR)
  - NATO phonetic substitutions that normalise to the same value
    ("niner"/"nine", "tree"/"three", "fife"/"five", "zero"/"oh")
  - A single-phoneme difference in a long numeric string where
    overall intent is clear
  For ambiguous readbacks: set readback_correct: null (cannot determine)
  and briefly describe the phonetic uncertainty in readback_discrepancy.
  Do NOT raise an observation solely on this basis.

═══════════════════════════════════════════════════════
MANDATORY READ-BACK ITEMS (ICAO Doc 4444 §4.5.3.1)
═══════════════════════════════════════════════════════

CRITICAL tier (incorrect read-back = high or critical severity):
  - Runway-in-use clearances (cleared to land / cleared for takeoff)
  - Hold-short instructions ("hold short of runway XX")
  - Crossing or backtrack clearances on active runways
  - TCAS Resolution Advisory compliance

HIGH tier (error = medium severity minimum):
  - Assigned altitudes and flight levels
  - Assigned headings
  - SSR/transponder codes (squawk)
  - Speed restrictions

LOWER tier (omission alone is NOT an observation):
  - Frequency changes (unless causing loss of communication)
  - QNH/altimeter settings (error is medium; omission alone is low)
  - Taxi routing (error matters; brevity does not)

═══════════════════════════════════════════════════════
OBSERVATION DECISION FRAMEWORK
═══════════════════════════════════════════════════════

Before flagging any observation, complete this checklist:

  ① Is this on the Mandatory Read-back list above?
     → If YES and incorrectly read back: flag it.
     → If YES and merely absent from transcript: do NOT flag
       (one-sided recording — you cannot see the other side).

  ② Does this deviation pass the Reasonable Controller Test?
     → If a competent controller would understand it without
       ambiguity: mark standard.

  ③ Can you write a specific, credible safety_pathway?
     Format: wrong action → mechanism → potential outcome.
     VALID: "Pilot read back FL110 instead of assigned FL120
             → crew levels at FL110 → potential conflict with
             opposite-direction traffic at FL110."
     INVALID: "Could cause confusion."
     → If you cannot write a valid pathway, do NOT flag.

  ④ Isolated vs systematic?
     → Single informal word: not an observation.
     → Repeated failure on safety-critical items in same
       transcript: medium severity minimum.

═══════════════════════════════════════════════════════
SEVERITY DEFINITIONS
═══════════════════════════════════════════════════════

critical — Immediate collision or emergency risk; breach of a
           safety-critical clearance with imminent consequences.

high     — Clear accident pathway exists; mandatory read-back item
           was demonstrably incorrect with immediate consequences.

medium   — Operational risk if pattern repeats or combines with
           other failures; single instance is concerning but not
           immediately dangerous.

low      — Technical deviation only; use sparingly and only when
           you can identify a plausible (not merely hypothetical)
           risk pathway. When in doubt between low and standard,
           choose standard.

═══════════════════════════════════════════════════════
RESPONSE FORMAT
═══════════════════════════════════════════════════════

Respond ONLY with a valid JSON array — one object per transcript,
in the same order as the input [INDEX] tags.

Each object schema:
{
  "index": <integer matching the [INDEX] tag>,
  "assessable": <boolean — false if transcript too garbled to evaluate>,
  "assessable_confidence": <float 0.0–1.0 — confidence in transcript quality>,
  "is_standard": <boolean — true if the transmission met standard phraseology;
    only meaningful when assessable is true>,
  "confidence_score": <float 0.0–1.0 — confidence in your phraseology assessment>,
  "summary": "<plain English; if assessable false, explain why>",
  "observations": [
    {
      "kind": <"phraseology_note" — non-standard phrasing, readback gaps,
        frequency confusion; OR "situational_event" — something operationally
        notable observed (go-around, emergency, TCAS RA, runway incursion,
        minimum/emergency fuel). Phraseology notes are educational; situational
        events are neutral awareness signals. Assign exactly one.>,
      "note_type": <one of ["Runway Incursion","Runway Excursion",
        "Altitude Deviation","Speed Deviation","Read-back Error",
        "Frequency/Channel Error","CFIT Risk","TCAS Non-compliance",
        "Go-around Non-compliance","Navigation Error",
        "Communication Failure","Fuel Mismanagement","Other"]>,
      "hfacs_level": <one of ["Unsafe Act","Precondition",
        "Unsafe Supervision","Organizational Influence"]>,
      "significance": <"low"|"medium"|"high"|"critical">,
      "description": "<what happened and why it matters>",
      "safety_pathway": "<wrong action → mechanism → potential outcome>",
      "relevant_regulation": "<e.g. ICAO Doc 4444 §4.5.3.1>",
      "transcript_excerpt": "<exact phrase from transcript>",
      "callsign": "<the aircraft this observation concerns, ICAO-format e.g. UAL12, or null>"
    }
  ],

  "speaker_segments": [
    {"role": "ATC|PILOT|UNKNOWN", "text": "<exact text of this turn>",
     "callsign": "<the aircraft this turn is to/from, ICAO-format, or null>"}
  ],
  "atc_instruction": "<the clearance/instruction the controller issued, or null>",
  "pilot_readback": "<what the pilot read back verbatim, or null — absence does NOT imply an observation>",
  "readback_correct": true_or_false_or_null,
  "readback_discrepancy": "<specific description e.g. Pilot read back 6000 ft instead of 8000 ft, or null>",
  "callsign_detected": "<ICAO-format callsign e.g. DAL456, or null>",
  "callsign_clarity": 0_to_100
}

speaker_segments: split transcript into labelled turns; if one-sided, label all with that speaker.
attribution: each turn and each observation belongs to ONE aircraft. A controller
turn addressing an aircraft and that aircraft's reply share the same callsign.
Use the SAME callsign string form as callsign_detected. For a general broadcast
or when the aircraft is unclear, set callsign null. callsign_detected remains the
primary (most prominent) callsign of the transcript.
readback_correct: true=matches; false=discrepancy; null=cannot determine (one-sided or no readback).
callsign_clarity: 90-100 standard ICAO format; 50-89 phonetically expanded; 20-49 partial; 0-19 none.

If assessable is false: set is_standard true, observations [], still populate enrichment fields.
If the transmission met standard phraseology: set observations [].
Always populate all enrichment fields.
"""


def _coerce_callsign(value) -> "str | None":
    """The model sometimes emits a list/number/object for a callsign field.
    Collapse to ``str | None`` so every consumer sees one shape."""
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, (list, tuple)) and value and isinstance(value[0], str):
        return value[0].strip() or None
    return None


async def analyze_batch(items: list[dict]) -> list[AnalysisResult]:
    """
    Analyze a batch of transcripts in a single Gemini call.
    Each item: { airport_code, transcript, timestamp (datetime) }
    Returns a list of AnalysisResult in the same order.
    """
    if not items:
        return []

    client = get_client()

    chunks_text = "\n\n".join(
        f"[{i} | {item['airport_code']} | {item['timestamp'].isoformat()}Z | "
        f"stt_conf={item.get('stt_confidence', 0.0):.2f}]\n\"\"\"\n{item['transcript']}\n\"\"\""
        for i, item in enumerate(items)
    )
    user_message = f"""Analyze the following {len(items)} ATC transcript(s) against FAA/ICAO standard phraseology.

{chunks_text}"""

    # Patterns that indicate a transient server-side or parse error worth
    # retrying — 5xx, Google-internal transient codes, JSON we couldn't parse.
    transient_markers = (
        "500", "502", "503", "504",
        "UNAVAILABLE", "INTERNAL", "DEADLINE_EXCEEDED", "RESOURCE_EXHAUSTED",
    )

    data = None
    last_exc: Exception | None = None
    for attempt in range(4):
        wait_before = 0.0
        try:
            async with get_semaphore():
                global _last_call_time
                gap = _MIN_INTERVAL - (time.monotonic() - _last_call_time)
                if gap > 0:
                    await asyncio.sleep(gap)
                _last_call_time = time.monotonic()
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=user_message,
                    config=types.GenerateContentConfig(
                        system_instruction=BATCH_SYSTEM_PROMPT,
                        response_mime_type="application/json",
                    ),
                )
            raw = response.text.strip()
            data = json.loads(raw)
            if isinstance(data, dict):
                data = [data]
            break
        except Exception as e:
            last_exc = e
            err = str(e)
            is_429 = "429" in err
            is_parse = isinstance(e, json.JSONDecodeError)
            is_transient = any(marker in err for marker in transient_markers)
            if is_429:
                m = re.search(r"retry in (\d+\.?\d*)", err)
                wait_before = float(m.group(1)) + 5 if m else 65
                print(f"[Gemini] 429 — waiting {wait_before:.0f}s (attempt {attempt+1}/4)", flush=True)
            elif is_parse or is_transient:
                wait_before = 5 * (attempt + 1)  # 5s, 10s, 15s, 20s
                label = "parse error" if is_parse else "transient error"
                print(f"[Gemini] {label} — retrying in {wait_before:.0f}s (attempt {attempt+1}/4): {e}", flush=True)
            else:
                print(f"[Gemini] Error ({type(e).__name__}): {e}", flush=True)
                raise
        if wait_before:
            await asyncio.sleep(wait_before)

    if data is None:
        raise RuntimeError(f"Gemini failed after 4 retries: {last_exc}")

    entries_by_index = {}
    for position, entry in enumerate(data):
        if not isinstance(entry, dict):
            continue
        idx = entry.get("index", position)
        if isinstance(idx, int) and 0 <= idx < len(items) and idx not in entries_by_index:
            entries_by_index[idx] = entry

    results = []
    for i, item in enumerate(items):
        entry = entries_by_index.get(i)
        if entry is None:
            results.append(_missing_analysis_result(
                item,
                f"Gemini analysis missing for transcript index {i}; result marked unassessable to preserve batch alignment.",
            ))
            continue

        assessable = entry.get("assessable", True)

        observations = []
        if assessable:
            for v in entry.get("observations", []):
                try:
                    note_type = v.get("note_type", "Other")
                    kind = v.get("kind") or KIND_BY_NOTE_TYPE.get(
                        note_type, "phraseology_note")
                    observations.append(Observation(
                        kind=kind,
                        note_type=note_type,
                        hfacs_level=v.get("hfacs_level", "Unsafe Act"),
                        significance=v.get("significance", "low"),
                        description=v.get("description", ""),
                        safety_pathway=v.get("safety_pathway"),
                        relevant_regulation=v.get("relevant_regulation"),
                        transcript_excerpt=v.get("transcript_excerpt"),
                        callsign=_coerce_callsign(v.get("callsign")),
                    ))
                except Exception:
                    continue

        # The LLM occasionally emits arrays / numbers / objects for
        # callsign_detected despite the prompt asking for a string. Coerce
        # at the persistence boundary so every consumer sees ``str | None``.
        callsign_detected = _coerce_callsign(entry.get("callsign_detected"))

        raw_clarity = entry.get("callsign_clarity", 0)
        try:
            callsign_clarity = int(raw_clarity)
        except (TypeError, ValueError):
            callsign_clarity = 0

        speaker_segments = []
        for s in (entry.get("speaker_segments") or []):
            if not isinstance(s, dict):
                continue
            speaker_segments.append({
                "role": s.get("role", "UNKNOWN"),
                "text": s.get("text", ""),
                "callsign": _coerce_callsign(s.get("callsign")),
            })

        enrichment = {
            "speaker_segments":      speaker_segments,
            "atc_instruction":       entry.get("atc_instruction"),
            "pilot_readback":        entry.get("pilot_readback"),
            "readback_correct":      entry.get("readback_correct"),
            "readback_discrepancy":  entry.get("readback_discrepancy"),
            "callsign_detected":     callsign_detected,
            "callsign_clarity":      callsign_clarity,
        }

        results.append(AnalysisResult(
            timestamp=item["timestamp"],
            airport_code=item["airport_code"],
            transcript=item["transcript"],
            assessable=assessable,
            assessable_confidence=item.get("stt_confidence", 0.0),
            is_standard=entry.get("is_standard", entry.get("is_compliant", True)),
            observations=observations,
            summary=entry.get("summary", ""),
            confidence_score=entry.get("confidence_score", 0.5),
            enrichment=enrichment,
        ))
    return results


async def generate_study_sheet(callsign: str, threads: list[dict]) -> str:
    client = get_client()

    timeline = "\n\n".join([
        f"[{t['timestamp']} | {t['airport_code']}]\n{t['transcript']}\n"
        f"→ Standard: {t['is_standard']} | {t['summary']}"
        for t in threads
    ])

    prompt = f"""You are an experienced flight instructor writing a study sheet
for an aviation enthusiast or student pilot reviewing real ATC communications.

Aircraft Callsign: {callsign}
Number of transmissions reviewed: {len(threads)}

--- TRANSMISSION TIMELINE ---
{timeline}
--- END TIMELINE ---

Write a short study sheet (200-300 words) covering:
1. **Overview** — what this aircraft was doing across these transmissions
2. **Phraseology Patterns** — how the phrasing compared to standard FAA/ICAO
   phraseology; call out good examples as well as non-standard ones
3. **Situational Events** — any operationally notable events observed
   (go-arounds, emergencies, etc.), described neutrally
4. **Study Suggestions** — what a student could practice or read up on

This is an educational study aid, not an investigation. Use plain English,
be encouraging, and do not assign blame to any individual."""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return response.text.strip()
    except Exception as e:
        return f"Study sheet generation failed: {type(e).__name__}: {e}"
