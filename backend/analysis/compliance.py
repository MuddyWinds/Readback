"""
Sends ATC transcripts to Gemini Flash for compliance analysis.
Uses batch analysis: collects transcripts from all airports over a window,
then sends ONE Gemini call covering all of them — conserving the daily quota.
"""

import asyncio
import json
import re
import time
from datetime import datetime

from google import genai
from google.genai import types

from backend.config import settings
from backend.models.schemas import AnalysisResult, Violation

_client = None
_semaphore: asyncio.Semaphore | None = None
_last_call_time: float = 0.0
_MIN_INTERVAL = 12.0  # seconds between calls

def get_semaphore() -> asyncio.Semaphore:
    global _semaphore
    if _semaphore is None:
        _semaphore = asyncio.Semaphore(1)
    return _semaphore

def get_client():
    global _client
    if _client is None:
        _client = genai.Client(api_key=settings.GEMINI_API_KEY)
    return _client


BATCH_SYSTEM_PROMPT = """You are an expert aviation safety analyst with 20+ years of ATC compliance
experience across FAA and ICAO regulatory frameworks.

═══════════════════════════════════════════════════════
CRITICAL CONTEXT — READ BEFORE ANALYSING
═══════════════════════════════════════════════════════

1. ONE-SIDED TRANSCRIPTS
   These transcripts may capture only ONE side of a radio exchange
   (controller only, or pilot only). NEVER flag a missing read-back
   or missing response as a violation — the other side may simply
   not have been recorded. Only flag what you can positively
   observe in the text.

2. TRANSCRIPTION NOISE
   This text was produced by an automatic speech recognition model
   from a live radio stream. Expect occasional garbled words,
   mis-heard callsigns, and filler sounds. Do not flag transcription
   artefacts as phraseology errors. If the transcript is too degraded
   to assess reliably, set assessable: false.

3. YOUR PRIMARY STANDARD
   Apply the "Reasonable Controller Test": would an experienced,
   qualified controller or pilot, hearing this transmission in a
   normal operational context, understand it completely and act
   correctly without any ambiguity? If YES → compliant,
   regardless of whether exact ICAO wording was used.

═══════════════════════════════════════════════════════
WHAT IS NEVER A VIOLATION
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
  Do NOT raise a violation solely on this basis.

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

LOWER tier (omission alone is NOT a violation):
  - Frequency changes (unless causing loss of communication)
  - QNH/altimeter settings (error is medium; omission alone is low)
  - Taxi routing (error matters; brevity does not)

═══════════════════════════════════════════════════════
VIOLATION DECISION FRAMEWORK
═══════════════════════════════════════════════════════

Before flagging any violation, complete this checklist:

  ① Is this on the Mandatory Read-back list above?
     → If YES and incorrectly read back: flag it.
     → If YES and merely absent from transcript: do NOT flag
       (one-sided recording — you cannot see the other side).

  ② Does this deviation pass the Reasonable Controller Test?
     → If a competent controller would understand it without
       ambiguity: mark compliant.

  ③ Can you write a specific, credible safety_pathway?
     Format: wrong action → mechanism → potential outcome.
     VALID: "Pilot read back FL110 instead of assigned FL120
             → crew levels at FL110 → potential conflict with
             opposite-direction traffic at FL110."
     INVALID: "Could cause confusion."
     → If you cannot write a valid pathway, do NOT flag.

  ④ Isolated vs systematic?
     → Single informal word: not a violation.
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
           risk pathway. When in doubt between low and compliant,
           choose compliant.

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
  "is_compliant": <boolean — only meaningful when assessable is true>,
  "confidence_score": <float 0.0–1.0 — confidence in your compliance verdict>,
  "summary": "<plain English; if assessable false, explain why>",
  "violations": [
    {
      "violation_type": <one of ["Runway Incursion","Runway Excursion",
        "Altitude Deviation","Speed Deviation","Read-back Error",
        "Frequency/Channel Error","CFIT Risk","TCAS Non-compliance",
        "Go-around Non-compliance","Navigation Error",
        "Communication Failure","Fuel Mismanagement","Other"]>,
      "hfacs_level": <one of ["Unsafe Act","Precondition",
        "Unsafe Supervision","Organizational Influence"]>,
      "severity": <"low"|"medium"|"high"|"critical">,
      "description": "<what happened and why it matters>",
      "safety_pathway": "<wrong action → mechanism → potential outcome>",
      "relevant_regulation": "<e.g. ICAO Doc 4444 §4.5.3.1>",
      "transcript_excerpt": "<exact phrase from transcript>"
    }
  ],

  "speaker_segments": [
    {"role": "ATC|PILOT|UNKNOWN", "text": "<exact text of this turn>"}
  ],
  "atc_instruction": "<the clearance/instruction the controller issued, or null>",
  "pilot_readback": "<what the pilot read back verbatim, or null — absence does NOT imply violation>",
  "readback_correct": true_or_false_or_null,
  "readback_discrepancy": "<specific description e.g. Pilot read back 6000 ft instead of 8000 ft, or null>",
  "callsign_detected": "<ICAO-format callsign e.g. DAL456, or null>",
  "callsign_clarity": 0_to_100
}

speaker_segments: split transcript into labelled turns; if one-sided, label all with that speaker.
readback_correct: true=matches; false=discrepancy; null=cannot determine (one-sided or no readback).
callsign_clarity: 90-100 standard ICAO format; 50-89 phonetically expanded; 20-49 partial; 0-19 none.

If assessable is false: set is_compliant true, violations [], still populate enrichment fields.
If compliant: set violations [].
Always populate all enrichment fields.
"""


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
        f"[{i} | {item['airport_code']} | {item['timestamp'].isoformat()}Z]\n\"\"\"\n{item['transcript']}\n\"\"\""
        for i, item in enumerate(items)
    )
    user_message = f"""Analyze the following {len(items)} ATC transcript(s) for FAA/ICAO compliance.

{chunks_text}"""

    data = None
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
            err = str(e)
            if "429" in err:
                m = re.search(r"retry in (\d+\.?\d*)", err)
                wait_before = float(m.group(1)) + 5 if m else 65
                print(f"[Gemini] 429 — waiting {wait_before:.0f}s (attempt {attempt+1}/4)", flush=True)
            else:
                print(f"[Gemini] Error ({type(e).__name__}): {e}", flush=True)
                raise
        if wait_before:
            await asyncio.sleep(wait_before)

    if data is None:
        raise RuntimeError("Gemini rate limited after 4 retries — skipping batch")

    results = []
    for i, item in enumerate(items):
        entry = next((d for d in data if d.get("index") == i), data[i] if i < len(data) else None)
        if entry is None:
            continue

        assessable = entry.get("assessable", True)
        assessable_confidence = entry.get("assessable_confidence", 0.5)

        violations = []
        if assessable:
            for v in entry.get("violations", []):
                try:
                    violations.append(Violation(
                        violation_type=v.get("violation_type", "Other"),
                        hfacs_level=v.get("hfacs_level", "Unsafe Act"),
                        severity=v.get("severity", "low"),
                        description=v.get("description", ""),
                        safety_pathway=v.get("safety_pathway"),
                        relevant_regulation=v.get("relevant_regulation"),
                        transcript_excerpt=v.get("transcript_excerpt"),
                    ))
                except Exception:
                    continue

        enrichment = {
            "speaker_segments":      entry.get("speaker_segments") or [],
            "atc_instruction":       entry.get("atc_instruction"),
            "pilot_readback":        entry.get("pilot_readback"),
            "readback_correct":      entry.get("readback_correct"),
            "readback_discrepancy":  entry.get("readback_discrepancy"),
            "callsign_detected":     entry.get("callsign_detected"),
            "callsign_clarity":      entry.get("callsign_clarity", 0),
        }

        results.append(AnalysisResult(
            timestamp=item["timestamp"],
            airport_code=item["airport_code"],
            transcript=item["transcript"],
            assessable=assessable,
            assessable_confidence=assessable_confidence,
            is_compliant=entry.get("is_compliant", True),
            violations=violations,
            summary=entry.get("summary", ""),
            confidence_score=entry.get("confidence_score", 0.5),
            enrichment=enrichment,
        ))
    return results


async def generate_aircraft_report(callsign: str, threads: list[dict]) -> str:
    client = get_client()

    timeline = "\n\n".join([
        f"[{t['timestamp']} | {t['airport_code']}]\n{t['transcript']}\n"
        f"→ Compliant: {t['is_compliant']} | {t['summary']}"
        for t in threads
    ])

    prompt = f"""You are an aviation safety investigator writing a concise incident report.

Aircraft Callsign: {callsign}
Number of transmissions analysed: {len(threads)}

--- TRANSMISSION TIMELINE ---
{timeline}
--- END TIMELINE ---

Write a short safety report (200-300 words) covering:
1. **Overview** — what this aircraft was doing across these transmissions
2. **Key Issues** — any repeated patterns, violations, or safety concerns
3. **HFACS Assessment** — what human factor category best explains any issues
4. **Recommendation** — what action a regulator should consider

Use plain English. Be concise and factual."""

    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
        )
        return response.text.strip()
    except Exception as e:
        return f"Report generation failed: {type(e).__name__}: {e}"
