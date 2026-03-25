"""
Post-processes AnalysisResult to produce summary statistics,
per-airport risk matrix, and violation intelligence for the dashboard.
Unassessable results are excluded from compliance rate calculations.
"""

from collections import defaultdict
from backend.models.schemas import AnalysisResult, SeverityLevel


def build_stats(results: list[AnalysisResult]) -> dict:
    total = len(results)
    assessable_results = [r for r in results if r.assessable]
    unassessable_count = total - len(assessable_results)

    non_compliant = sum(1 for r in assessable_results if not r.is_compliant)
    assessable_total = len(assessable_results)

    severity_counts: dict[str, int] = defaultdict(int)
    airport_totals: dict[str, int] = defaultdict(int)
    airport_non_compliant: dict[str, int] = defaultdict(int)
    airport_unassessable: dict[str, int] = defaultdict(int)
    airport_matrix: dict[str, dict] = {}
    violation_details: dict[str, dict] = {}

    for result in results:
        code = result.airport_code
        airport_totals[code] += 1

        if not result.assessable:
            airport_unassessable[code] += 1
            if code not in airport_matrix:
                airport_matrix[code] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "checked": 0, "unassessable": 0}
            airport_matrix[code]["unassessable"] = airport_matrix[code].get("unassessable", 0) + 1
            continue

        if not result.is_compliant:
            airport_non_compliant[code] += 1

        if code not in airport_matrix:
            airport_matrix[code] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "checked": 0, "unassessable": 0}
        airport_matrix[code]["checked"] += 1

        for v in result.violations:
            sev = v.severity.value
            vt = v.violation_type.value

            severity_counts[sev] += 1
            airport_matrix[code][sev] += 1

            if vt not in violation_details:
                violation_details[vt] = {
                    "count": 0,
                    "critical": 0, "high": 0, "medium": 0, "low": 0,
                    "airports": defaultdict(int),
                }
            violation_details[vt]["count"] += 1
            violation_details[vt][sev] += 1
            violation_details[vt]["airports"][code] += 1

    # Compliance rate excludes unassessable results
    airport_compliance = {}
    for code in airport_totals:
        assessable = airport_totals[code] - airport_unassessable.get(code, 0)
        if assessable > 0:
            nc = airport_non_compliant.get(code, 0)
            airport_compliance[code] = round((assessable - nc) / assessable * 100, 1)
        else:
            airport_compliance[code] = None  # all unassessable — no rate

    return {
        "total_chunks_analyzed": total,
        "assessable_chunks": assessable_total,
        "unassessable_chunks": unassessable_count,
        "non_compliant_chunks": non_compliant,
        "compliance_rate": round((assessable_total - non_compliant) / assessable_total * 100, 1) if assessable_total else None,
        "severity_breakdown": {
            SeverityLevel.CRITICAL: severity_counts.get("critical", 0),
            SeverityLevel.HIGH:     severity_counts.get("high", 0),
            SeverityLevel.MEDIUM:   severity_counts.get("medium", 0),
            SeverityLevel.LOW:      severity_counts.get("low", 0),
        },
        "airport_compliance": airport_compliance,
        "airport_risk_matrix": airport_matrix,
        "violation_type_details": {
            vt: {
                "count":    d["count"],
                "critical": d["critical"],
                "high":     d["high"],
                "medium":   d["medium"],
                "low":      d["low"],
                "top_airport": max(d["airports"].items(), key=lambda x: x[1])[0]
                               if d["airports"] else None,
            }
            for vt, d in violation_details.items()
        },
    }
