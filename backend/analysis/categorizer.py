"""
Post-processes AnalysisResult to produce summary statistics,
per-airport risk matrix, and phraseology/event intelligence for the dashboard.
Unassessable results are excluded from conformance rate calculations.
"""

from collections import defaultdict
from backend.models.schemas import AnalysisResult, SignificanceLevel


def build_stats(results: list[AnalysisResult]) -> dict:
    total = len(results)
    assessable_results = [r for r in results if r.assessable]
    unassessable_count = total - len(assessable_results)

    non_standard = sum(1 for r in assessable_results if not r.is_standard)
    assessable_total = len(assessable_results)

    severity_counts: dict[str, int] = defaultdict(int)
    hfacs_counts: dict[str, int] = defaultdict(int)
    airport_totals: dict[str, int] = defaultdict(int)
    airport_non_standard: dict[str, int] = defaultdict(int)
    airport_unassessable: dict[str, int] = defaultdict(int)
    airport_matrix: dict[str, dict] = {}
    note_details: dict[str, dict] = {}

    for result in results:
        code = result.airport_code
        airport_totals[code] += 1

        if not result.assessable:
            airport_unassessable[code] += 1
            if code not in airport_matrix:
                airport_matrix[code] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "checked": 0, "unassessable": 0}
            airport_matrix[code]["unassessable"] = airport_matrix[code].get("unassessable", 0) + 1
            continue

        if not result.is_standard:
            airport_non_standard[code] += 1

        if code not in airport_matrix:
            airport_matrix[code] = {"critical": 0, "high": 0, "medium": 0, "low": 0, "checked": 0, "unassessable": 0}
        airport_matrix[code]["checked"] += 1

        for v in result.observations:
            sev = v.significance.value
            vt = v.note_type.value

            severity_counts[sev] += 1
            hfacs_counts[v.hfacs_level.value] += 1
            airport_matrix[code][sev] += 1

            if vt not in note_details:
                note_details[vt] = {
                    "count": 0,
                    "critical": 0, "high": 0, "medium": 0, "low": 0,
                    "airports": defaultdict(int),
                }
            note_details[vt]["count"] += 1
            note_details[vt][sev] += 1
            note_details[vt]["airports"][code] += 1

    # Conformance rate excludes unassessable results
    airport_conformance = {}
    for code in airport_totals:
        assessable = airport_totals[code] - airport_unassessable.get(code, 0)
        if assessable > 0:
            nc = airport_non_standard.get(code, 0)
            airport_conformance[code] = round((assessable - nc) / assessable * 100, 1)
        else:
            airport_conformance[code] = None  # all unassessable — no rate

    return {
        "total_chunks_analyzed": total,
        "assessable_chunks": assessable_total,
        "unassessable_chunks": unassessable_count,
        "non_standard_chunks": non_standard,
        "conformance_rate": round((assessable_total - non_standard) / assessable_total * 100, 1) if assessable_total else None,
        "severity_breakdown": {
            SignificanceLevel.CRITICAL: severity_counts.get("critical", 0),
            SignificanceLevel.HIGH:     severity_counts.get("high", 0),
            SignificanceLevel.MEDIUM:   severity_counts.get("medium", 0),
            SignificanceLevel.LOW:      severity_counts.get("low", 0),
        },
        "hfacs_breakdown": dict(hfacs_counts),
        "airport_conformance": airport_conformance,
        "airport_risk_matrix": airport_matrix,
        "note_type_details": {
            vt: {
                "count":    d["count"],
                "critical": d["critical"],
                "high":     d["high"],
                "medium":   d["medium"],
                "low":      d["low"],
                "top_airport": max(d["airports"].items(), key=lambda x: x[1])[0]
                               if d["airports"] else None,
            }
            for vt, d in note_details.items()
        },
    }
