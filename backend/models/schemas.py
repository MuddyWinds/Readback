from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_serializer


def _iso_utc(dt: datetime) -> str:
    """Serialize naive-UTC datetimes with a trailing ``Z`` so downstream
    JavaScript clients don't have to second-guess timezone semantics."""
    iso = dt.isoformat()
    return iso if iso.endswith("Z") else iso + "Z"


class HFACSLevel1(str, Enum):
    UNSAFE_ACT = "Unsafe Act"
    PRECONDITION = "Precondition"
    UNSAFE_SUPERVISION = "Unsafe Supervision"
    ORGANIZATIONAL = "Organizational Influence"


class ObservationKind(str, Enum):
    PHRASEOLOGY_NOTE = "phraseology_note"
    SITUATIONAL_EVENT = "situational_event"


class NoteType(str, Enum):
    RUNWAY_INCURSION = "Runway Incursion"
    RUNWAY_EXCURSION = "Runway Excursion"
    ALTITUDE_DEVIATION = "Altitude Deviation"
    SPEED_DEVIATION = "Speed Deviation"
    READBACK_ERROR = "Read-back Error"
    FREQUENCY_ERROR = "Frequency/Channel Error"
    CFIT_RISK = "CFIT Risk"
    TCAS_NON_COMPLIANCE = "TCAS Non-compliance"
    GO_AROUND_NON_COMPLIANCE = "Go-around Non-compliance"
    NAVIGATION_ERROR = "Navigation Error"
    COMMUNICATION_FAILURE = "Communication Failure"
    FUEL_MISMANAGEMENT = "Fuel Mismanagement"
    OTHER = "Other"


# Maps each note_type to its observation kind (spec §4).
KIND_BY_NOTE_TYPE: dict[str, ObservationKind] = {
    "Read-back Error":          ObservationKind.PHRASEOLOGY_NOTE,
    "Frequency/Channel Error":  ObservationKind.PHRASEOLOGY_NOTE,
    "Communication Failure":    ObservationKind.PHRASEOLOGY_NOTE,
    "Navigation Error":         ObservationKind.PHRASEOLOGY_NOTE,
    "Other":                    ObservationKind.PHRASEOLOGY_NOTE,
    "Runway Incursion":         ObservationKind.SITUATIONAL_EVENT,
    "Runway Excursion":         ObservationKind.SITUATIONAL_EVENT,
    "Altitude Deviation":       ObservationKind.SITUATIONAL_EVENT,
    "Speed Deviation":          ObservationKind.SITUATIONAL_EVENT,
    "CFIT Risk":                ObservationKind.SITUATIONAL_EVENT,
    "TCAS Non-compliance":      ObservationKind.SITUATIONAL_EVENT,
    "Go-around Non-compliance": ObservationKind.SITUATIONAL_EVENT,
    "Fuel Mismanagement":       ObservationKind.SITUATIONAL_EVENT,
}


class SignificanceLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class ObservationDetailPoint(BaseModel):
    text: str
    transcript_excerpt: Optional[str] = None


class Observation(BaseModel):
    kind: ObservationKind
    note_type: NoteType
    hfacs_level: HFACSLevel1
    significance: SignificanceLevel
    description: str
    safety_pathway: Optional[str] = None   # teaching explanation: why this phraseology matters
    relevant_regulation: Optional[str] = None
    transcript_excerpt: Optional[str] = None
    detail_points: list[ObservationDetailPoint] = Field(default_factory=list)
    callsign: Optional[str] = None         # aircraft this observation concerns, or None


class TranscriptChunk(BaseModel):
    id: Optional[int] = None
    timestamp: datetime
    airport_code: str
    feed_url: str
    raw_text: str
    duration_seconds: int


class AnalysisResult(BaseModel):
    chunk_id: Optional[int] = None
    timestamp: datetime
    airport_code: str
    transcript: str
    assessable: bool = True               # False = transcript too degraded
    assessable_confidence: float = 1.0    # STT/Gemini quality confidence
    is_standard: bool                     # met standard phraseology
    observations: list[Observation]
    summary: str
    confidence_score: float  # 0.0 - 1.0
    enrichment: Optional[dict] = None     # speaker_segments, readback comparison, callsign clarity

    @field_serializer("timestamp")
    def _serialize_timestamp(self, value: datetime) -> str:
        return _iso_utc(value)
