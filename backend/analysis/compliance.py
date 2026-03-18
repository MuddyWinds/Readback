"""
Sends ATC transcript to Gemini Flash for compliance analysis.
Returns a structured AnalysisResult with detected violations and HFACS categories.
"""

import json
from datetime import datetime

import google.generativeai as genai

from backend.config import settings
from backend.models.schemas import AnalysisResult, Violation

_model = None

SYSTEM_PROMPT = """You are an expert aviation safety analyst specializing in FAA regulations,
ICAO standards, and the Human Factors Analysis and Classification System (HFACS).

Your task is to analyze ATC (Air Traffic Control) radio transcripts for regulatory compliance.
Identify any violations, deviations, or safety concerns using official FAA regulations (14 CFR),
ICAO phraseology standards, and HFACS taxonomy.

Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

Response schema:
{
  "is_compliant": boolean,
  "confidence_score": float (0.0-1.0),
  "summary": "Brief plain-English summary of findings",
  "violations": [
    {
      "violation_type": one of ["Runway Incursion","Runway Excursion","Altitude Deviation",
        "Speed Deviation","Read-back Error","Frequency/Channel Error","CFIT Risk",
        "TCAS Non-compliance","Go-around Non-compliance","Navigation Error",
        "Communication Failure","Fuel Mismanagement","Other"],
      "hfacs_level": one of ["Unsafe Act","Precondition","Unsafe Supervision","Organizational Influence"],
      "severity": one of ["low","medium","high","critical"],
      "description": "What happened and why it is a violation",
      "relevant_regulation": "e.g. 14 CFR 91.123 or ICAO Doc 4444",
      "transcript_excerpt": "The exact phrase from the transcript that triggered this"
    }
  ]
}

If the transcript is compliant, return violations as an empty array [].
If the transcript is too short, garbled, or contains no meaningful ATC communication,
set is_compliant to true and confidence_score below 0.3."""


def get_model():
    global _model
    if _model is None:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        _model = genai.GenerativeModel(
            model_name="gemini-2.0-flash",
            system_instruction=SYSTEM_PROMPT,
            generation_config={"response_mime_type": "application/json"},
        )
    return _model


async def analyze_transcript(
    transcript: str, airport_code: str
) -> AnalysisResult:
    """
    Analyze an ATC transcript for FAA/ICAO compliance using Gemini Flash.
    """
    model = get_model()

    user_message = f"""Airport: {airport_code}
Timestamp: {datetime.utcnow().isoformat()}Z

ATC Transcript:
\"\"\"
{transcript}
\"\"\"

Analyze this transcript for compliance with FAA regulations and ICAO standards.
Flag any read-back errors, incorrect phraseology, altitude/speed deviations,
runway incursions, or other safety-relevant deviations."""

    response = model.generate_content(user_message)
    raw = response.text.strip()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {
            "is_compliant": True,
            "confidence_score": 0.1,
            "summary": "Unable to parse analysis result.",
            "violations": [],
        }

    violations = [Violation(**v) for v in data.get("violations", [])]

    return AnalysisResult(
        timestamp=datetime.utcnow(),
        airport_code=airport_code,
        transcript=transcript,
        is_compliant=data.get("is_compliant", True),
        violations=violations,
        summary=data.get("summary", ""),
        confidence_score=data.get("confidence_score", 0.5),
    )
