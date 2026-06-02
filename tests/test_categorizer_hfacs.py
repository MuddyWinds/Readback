from backend.analysis.categorizer import build_stats
from backend.models.schemas import (
    AnalysisResult, Observation, ObservationKind, NoteType, HFACSLevel1, SignificanceLevel,
)
from datetime import datetime


def _obs(hfacs):
    return Observation(
        kind=ObservationKind.PHRASEOLOGY_NOTE,
        note_type=NoteType.READBACK_ERROR,
        hfacs_level=hfacs,
        significance=SignificanceLevel.MEDIUM,
        description="x",
    )


def _result(obs):
    return AnalysisResult(
        timestamp=datetime.utcnow(), airport_code="KSFO", transcript="t",
        assessable=True, is_standard=False, observations=obs,
        summary="s", confidence_score=0.9,
    )


def test_hfacs_breakdown_counts_by_level():
    a = HFACSLevel1.UNSAFE_ACT  # value "Unsafe Act"
    results = [_result([_obs(a), _obs(a)]), _result([_obs(a)])]
    stats = build_stats(results)
    assert "hfacs_breakdown" in stats
    assert stats["hfacs_breakdown"]["Unsafe Act"] == 3
