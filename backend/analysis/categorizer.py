"""
Post-processes AnalysisResult to produce summary statistics
and HFACS category breakdowns for the dashboard.
"""

from collections import defaultdict
from backend.models.schemas import AnalysisResult, HFACSLevel1, SeverityLevel


def build_stats(results: list[AnalysisResult]) -> dict:
    """
    Aggregate a list of AnalysisResults into dashboard-ready stats.
    """
    total = len(results)
    non_compliant = sum(1 for r in results if not r.is_compliant)

    violation_counts: dict[str, int] = defaultdict(int)
    hfacs_counts: dict[str, int] = defaultdict(int)
    severity_counts: dict[str, int] = defaultdict(int)

    for result in results:
        for v in result.violations:
            violation_counts[v.violation_type.value] += 1
            hfacs_counts[v.hfacs_level.value] += 1
            severity_counts[v.severity.value] += 1

    return {
        "total_chunks_analyzed": total,
        "non_compliant_chunks": non_compliant,
        "compliance_rate": round((total - non_compliant) / total * 100, 1) if total else 0,
        "violation_type_breakdown": dict(violation_counts),
        "hfacs_breakdown": dict(hfacs_counts),
        "severity_breakdown": {
            SeverityLevel.CRITICAL: severity_counts.get("critical", 0),
            SeverityLevel.HIGH: severity_counts.get("high", 0),
            SeverityLevel.MEDIUM: severity_counts.get("medium", 0),
            SeverityLevel.LOW: severity_counts.get("low", 0),
        },
    }
