from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel


class HFACSLevel1(str, Enum):
    UNSAFE_ACT = "Unsafe Act"
    PRECONDITION = "Precondition"
    UNSAFE_SUPERVISION = "Unsafe Supervision"
    ORGANIZATIONAL = "Organizational Influence"


class ViolationType(str, Enum):
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


class SeverityLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class Violation(BaseModel):
    violation_type: ViolationType
    hfacs_level: HFACSLevel1
    severity: SeverityLevel
    description: str
    relevant_regulation: Optional[str] = None
    transcript_excerpt: Optional[str] = None


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
    is_compliant: bool
    violations: list[Violation]
    summary: str
    confidence_score: float  # 0.0 - 1.0
