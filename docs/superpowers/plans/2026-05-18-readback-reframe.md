# Readback Reframe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe the project from "ATC Compliance Monitor" (enforcement) to "Readback" — an educational ATC phraseology learning and situational-awareness tool — across docs, terminology, the analysis taxonomy, the data model, and the API.

**Architecture:** A rename-and-reframe pass over an existing FastAPI + SQLAlchemy backend and a React/TypeScript frontend. The one substantive behavior change is splitting the single "violation" output into two concepts — **Phraseology Notes** (educational) and **Situational Events** (neutral awareness) — carried by a new `kind` field. One one-shot SQLite migration rewrites the existing `atcmonitor.db`. No re-architecture: the Whisper pipeline, batching, Gemini call, and ADS-B integration are untouched.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2 (async) / SQLite (`atcmonitor.db`) / Pydantic 2 / google-genai (Gemini 2.5 Flash) / React 18 + TypeScript (CRA / react-scripts).

**Source spec:** `docs/superpowers/specs/2026-05-18-readback-reframe-design.md`. Section references (§N) point there.

**Testing note:** the repo has no test framework or test files. Adding one for a rename-heavy reframe is out of scope. Verification is therefore command-based: `python3 -c "import ..."` for backend modules, `npm run build` for the frontend, and a scripted check for the migration. Task 4 (the migration) is the one place with a written test, run against a scratch copy of the DB.

**Reference — §4 taxonomy mapping** (used in Tasks 2, 4, 5):

| `note_type` value | `kind` |
|---|---|
| Read-back Error | phraseology_note |
| Frequency/Channel Error | phraseology_note |
| Communication Failure | phraseology_note |
| Navigation Error | phraseology_note |
| Other | phraseology_note |
| Runway Incursion | situational_event |
| Runway Excursion | situational_event |
| Altitude Deviation | situational_event |
| Speed Deviation | situational_event |
| CFIT Risk | situational_event |
| TCAS Non-compliance | situational_event |
| Go-around Non-compliance | situational_event |
| Fuel Mismanagement | situational_event |

---

## File Structure

Files created or modified, by responsibility:

- `backend/models/schemas.py` — **modify**: `Violation`→`Observation` (+`kind`), enum renames, `AnalysisResult` field renames.
- `backend/db/models.py` — **modify**: `AnalysisResultDB` column renames.
- `backend/db/database.py` — **modify**: `init_db()` inline-migration list.
- `backend/db/migrations/__init__.py` — **create**: empty package marker.
- `backend/db/migrations/0001_readback_reframe.py` — **create**: one-shot migration script.
- `backend/analysis/phraseology.py` — **create** (git-mv of `compliance.py`): analyzer + prompt + study sheet.
- `backend/analysis/compliance.py` — **delete** (renamed).
- `backend/analysis/categorizer.py` — **modify**: stat key renames.
- `backend/core/batcher.py` — **modify**: import + field-name updates, keyword constant rename.
- `backend/api/results.py` — **modify**: field names, `_VALID_STATUSES`, stats passthrough.
- `backend/api/reports.py` — **modify**: route + function rename.
- `backend/main.py` — **modify**: app title.
- `frontend/src/components/LiveFeed.tsx` — **modify**: types, field names, labels, two-card rendering.
- `frontend/src/components/StatsPanel.tsx` — **modify**: stat keys, labels.
- `frontend/src/components/SituationRoom.tsx` — **modify**: labels, field names.
- `frontend/src/components/AirportSidebar.tsx` — **modify**: labels.
- `frontend/src/App.tsx` — **modify**: title, labels, footer advisory line.
- `frontend/src/index.tsx` — **modify**: document title if set.
- `frontend/src/components/ViolationCard.tsx` — **delete**: dead stub.
- `README.md`, `CONTRIBUTING.md` — **modify**: positioning rewrite.
- `docs/superpowers/specs/2026-04-15-aircraft-info-page-and-false-positive-reduction-design.md` — **modify**: terminology pass.

---

## Task 1: Terminology pass on the 2026-04-15 spec

Pure documentation. No code, no risk. Brings the in-flight spec into the new vocabulary so the two specs do not diverge (§9).

**Files:**
- Modify: `docs/superpowers/specs/2026-04-15-aircraft-info-page-and-false-positive-reduction-design.md`

- [ ] **Step 1: Add a pointer note at the top of the spec**

Directly under the `# Aircraft Info Page + False-Positive Reduction — Design Spec` heading, add:

```markdown
> **Vocabulary note (2026-05-18):** This spec predates the Readback reframe.
> Terminology here follows `2026-05-18-readback-reframe-design.md`, which is the
> source of truth for naming. "Compliance"/"violation" wording below has been
> updated to "phraseology"/"phraseology note"/"situational event" accordingly.
```

- [ ] **Step 2: Apply the terminology substitutions throughout the file**

Apply these replacements across the whole document (case-insensitive intent, preserve surrounding capitalization):

- "Compliance Monitor" / "compliance monitor" → "Readback"
- "compliance" (as analysis noun) → "phraseology"
- "Compliance Analyzer" → "Phraseology Analyzer"
- "Compliance Pipeline Upgrade" → "Phraseology Pipeline Upgrade"
- "compliance.py" → "phraseology.py"
- "violation(s)" → "phraseology note(s) / situational event(s)" on first mention in a section, "observation(s)" where a single collective term is needed
- "ViolationCard" → "PhraseologyNoteCard / EventCard"
- "Violation" (Pydantic model) → "Observation"
- `active_violations` → `active_observations`; `historical_violations` → `historical_observations`
- `disputed_examples` → `feedback_examples`; `DisputedExample` → `FeedbackExample`
- "disputed" (as a status/feature) → "feedback"; `confirmed_fp` retained as a status value

Leave architecture, phase tables, and design decisions unchanged — terminology only.

- [ ] **Step 3: Verify no stale terms remain**

Run: `grep -niE 'compliance|violation' docs/superpowers/specs/2026-04-15-aircraft-info-page-and-false-positive-reduction-design.md`
Expected: only intentional occurrences remain — `confirmed_fp`, the word inside the `2026-04-15` filename if referenced, and any direct quote of an external regulation title. No "Compliance Monitor", no "ViolationCard", no `Violation` model references.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-04-15-aircraft-info-page-and-false-positive-reduction-design.md
git commit -m "docs: terminology pass on 2026-04-15 spec for Readback reframe"
```

---

## Task 2: Pydantic model — Observation with `kind`

Rename the `Violation` model to `Observation`, add the `kind` field, rename the enums and `AnalysisResult` fields (§7.1).

**Files:**
- Modify: `backend/models/schemas.py`

- [ ] **Step 1: Replace the enums and the `Violation` model**

In `backend/models/schemas.py`, replace the `ViolationType`, `SeverityLevel`, and `Violation` definitions (lines 14–44) with:

```python
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


class Observation(BaseModel):
    kind: ObservationKind
    note_type: NoteType
    hfacs_level: HFACSLevel1
    significance: SignificanceLevel
    description: str
    safety_pathway: Optional[str] = None   # teaching explanation: why this phraseology matters
    relevant_regulation: Optional[str] = None
    transcript_excerpt: Optional[str] = None
```

- [ ] **Step 2: Update `AnalysisResult`**

In the `AnalysisResult` model (lines 56–67), rename `is_compliant` → `is_standard` and `violations: list[Violation]` → `observations: list[Observation]`:

```python
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
```

- [ ] **Step 3: Verify the module imports cleanly**

Run: `python3 -c "from backend.models.schemas import Observation, ObservationKind, NoteType, SignificanceLevel, AnalysisResult, KIND_BY_NOTE_TYPE; print('ok', len(KIND_BY_NOTE_TYPE))"`
Expected: `ok 13`

- [ ] **Step 4: Commit**

```bash
git add backend/models/schemas.py
git commit -m "refactor: Violation -> Observation model with kind field"
```

Note: this commit intentionally leaves importers broken (`backend.analysis.compliance` still imports `Violation`). They are fixed in Tasks 5–7. Do not run the full app between Task 2 and Task 7.

---

## Task 3: SQLAlchemy model and `init_db`

Rename the columns on `AnalysisResultDB` and update the fresh-DB inline migration (§7.2).

**Files:**
- Modify: `backend/db/models.py`
- Modify: `backend/db/database.py`

- [ ] **Step 1: Rename columns in `AnalysisResultDB`**

In `backend/db/models.py`, in class `AnalysisResultDB`, change three lines:

```python
    is_standard = Column(Boolean)
    observations = Column(JSON)   # list of Observation dicts
```

(replacing `is_compliant = Column(Boolean)` and `violations = Column(JSON)   # list of Violation dicts`)

and:

```python
    reviewer_notes = Column(Text, nullable=True)
```

(replacing `officer_notes = Column(Text, nullable=True)`)

- [ ] **Step 2: Update the `init_db` inline migration list**

In `backend/db/database.py`, the `init_db()` function has a list of `ALTER TABLE` statements for older databases. Replace that list so a freshly created DB and a migrated DB converge on the same column names:

```python
        # Migrate: add columns to existing SQLite databases
        for migration in [
            "ALTER TABLE analysis_results ADD COLUMN enrichment TEXT",
            "ALTER TABLE analysis_results ADD COLUMN status TEXT DEFAULT 'new'",
            "ALTER TABLE analysis_results ADD COLUMN reviewer_notes TEXT",
        ]:
```

(only `officer_notes` → `reviewer_notes` changes; the migration script in Task 4 handles the rename of pre-existing `officer_notes` columns.)

- [ ] **Step 3: Verify both modules import**

Run: `python3 -c "from backend.db.models import AnalysisResultDB; c={col.name for col in AnalysisResultDB.__table__.columns}; assert {'is_standard','observations','reviewer_notes'} <= c, c; assert not {'is_compliant','violations','officer_notes'} & c, c; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add backend/db/models.py backend/db/database.py
git commit -m "refactor: rename AnalysisResultDB columns for Readback reframe"
```

---

## Task 4: Migration script for `atcmonitor.db`

A one-shot script that renames columns and rewrites the `observations` JSON in the existing database (§7.3). This is the only irreversible step — it backs up first and is tested on a scratch copy.

**Files:**
- Create: `backend/db/migrations/__init__.py`
- Create: `backend/db/migrations/0001_readback_reframe.py`

- [ ] **Step 1: Create the package marker**

Create `backend/db/migrations/__init__.py` with a single line:

```python
# Migration scripts for atcmonitor.db — run manually, newest last.
```

- [ ] **Step 2: Write the migration script**

Create `backend/db/migrations/0001_readback_reframe.py`:

```python
"""
One-shot migration: ATC Compliance Monitor -> Readback reframe.

Renames columns on analysis_results and rewrites the observations JSON
so each finding carries `kind`, `note_type`, and `significance`.

Usage:  python3 -m backend.db.migrations.0001_readback_reframe [path/to/atcmonitor.db]
Idempotent: exits early if already migrated.
"""

import json
import shutil
import sqlite3
import sys

# spec §4 mapping — kept inline so the migration has no app-code dependency.
KIND_BY_NOTE_TYPE = {
    "Read-back Error": "phraseology_note",
    "Frequency/Channel Error": "phraseology_note",
    "Communication Failure": "phraseology_note",
    "Navigation Error": "phraseology_note",
    "Other": "phraseology_note",
    "Runway Incursion": "situational_event",
    "Runway Excursion": "situational_event",
    "Altitude Deviation": "situational_event",
    "Speed Deviation": "situational_event",
    "CFIT Risk": "situational_event",
    "TCAS Non-compliance": "situational_event",
    "Go-around Non-compliance": "situational_event",
    "Fuel Mismanagement": "situational_event",
}


def _columns(conn, table):
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def migrate(db_path: str) -> None:
    if sqlite3.sqlite_version_info < (3, 25, 0):
        raise RuntimeError(f"SQLite >= 3.25 required for RENAME COLUMN; have {sqlite3.sqlite_version}")

    conn = sqlite3.connect(db_path)
    try:
        cols = _columns(conn, "analysis_results")
        if "observations" in cols:
            print(f"[migrate] {db_path} already migrated — nothing to do.")
            return

        backup = db_path + ".pre-readback.bak"
        shutil.copy2(db_path, backup)
        print(f"[migrate] backed up -> {backup}")

        if "is_compliant" in cols:
            conn.execute("ALTER TABLE analysis_results RENAME COLUMN is_compliant TO is_standard")
        conn.execute("ALTER TABLE analysis_results RENAME COLUMN violations TO observations")
        if "officer_notes" in cols:
            conn.execute("ALTER TABLE analysis_results RENAME COLUMN officer_notes TO reviewer_notes")

        rows = conn.execute("SELECT id, observations FROM analysis_results").fetchall()
        rewritten = 0
        findings = 0
        for row_id, raw in rows:
            if not raw:
                continue
            data = json.loads(raw)
            if not isinstance(data, list):
                continue
            for f in data:
                if "violation_type" in f:
                    f["note_type"] = f.pop("violation_type")
                if "severity" in f:
                    f["significance"] = f.pop("severity")
                f["kind"] = KIND_BY_NOTE_TYPE.get(f.get("note_type"), "phraseology_note")
                findings += 1
            conn.execute(
                "UPDATE analysis_results SET observations = ? WHERE id = ?",
                (json.dumps(data), row_id),
            )
            rewritten += 1

        conn.execute("UPDATE analysis_results SET status='confirmed' WHERE status='escalated'")
        conn.commit()
        print(f"[migrate] done: {len(rows)} rows scanned, "
              f"{rewritten} rewritten, {findings} findings updated.")
    finally:
        conn.close()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "atcmonitor.db"
    migrate(path)
```

- [ ] **Step 3: Write a test against a scratch copy of the real DB**

Run this exact sequence (it copies the live DB, migrates the copy, and asserts the result):

```bash
cp atcmonitor.db /tmp/readback_test.db
python3 -m backend.db.migrations.0001_readback_reframe /tmp/readback_test.db
python3 - <<'EOF'
import json, sqlite3
c = sqlite3.connect("/tmp/readback_test.db")
cols = {r[1] for r in c.execute("PRAGMA table_info(analysis_results)")}
assert "observations" in cols and "is_standard" in cols, cols
assert "violations" not in cols and "is_compliant" not in cols, cols
bad = 0
for (raw,) in c.execute("SELECT observations FROM analysis_results"):
    if not raw: continue
    for f in json.loads(raw):
        assert f["kind"] in ("phraseology_note", "situational_event"), f
        assert "note_type" in f and "significance" in f, f
        assert "violation_type" not in f and "severity" not in f, f
        bad += 0
assert not list(c.execute("SELECT 1 FROM analysis_results WHERE status='escalated'"))
print("MIGRATION TEST PASS")
EOF
```

Expected: prints migration summary, then `MIGRATION TEST PASS`.

- [ ] **Step 4: Verify idempotency**

Run: `python3 -m backend.db.migrations.0001_readback_reframe /tmp/readback_test.db`
Expected: `[migrate] /tmp/readback_test.db already migrated — nothing to do.`

- [ ] **Step 5: Migrate the real database**

Run: `python3 -m backend.db.migrations.0001_readback_reframe atcmonitor.db`
Expected: backup line + migration summary. Confirm `atcmonitor.db.pre-readback.bak` now exists.

- [ ] **Step 6: Commit**

```bash
git add backend/db/migrations/
git commit -m "feat: add Readback reframe DB migration script"
```

(`.gitignore` already excludes `atcmonitor.db`; the migrated DB and `.bak` are not committed.)

---

## Task 5: Analyzer — `compliance.py` -> `phraseology.py`

Rename the analyzer module, update its prompt to emit `kind` and new vocabulary, build `Observation`s, and reframe the study-sheet generator (§7.4, §10).

**Files:**
- Create (via git mv): `backend/analysis/phraseology.py`
- Delete: `backend/analysis/compliance.py`

- [ ] **Step 1: Rename the file with git**

Run: `git mv backend/analysis/compliance.py backend/analysis/phraseology.py`

- [ ] **Step 2: Update the module docstring and imports**

In `backend/analysis/phraseology.py`, replace the top docstring (lines 1–5) with:

```python
"""
Sends ATC transcripts to Gemini Flash for phraseology analysis.
Uses batch analysis: collects transcripts from all airports over a window,
then sends ONE Gemini call covering all of them — conserving the daily quota.
Produces Observations classified as phraseology notes or situational events.
"""
```

and change the import line `from backend.models.schemas import AnalysisResult, Violation` to:

```python
from backend.models.schemas import AnalysisResult, Observation, KIND_BY_NOTE_TYPE
```

- [ ] **Step 3: Update the `RESPONSE FORMAT` section of `BATCH_SYSTEM_PROMPT`**

In `BATCH_SYSTEM_PROMPT`, replace the `violations` array schema block (the `"violations": [ ... ]` object inside the response schema, originally lines 178–193) with:

```
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
      "transcript_excerpt": "<exact phrase from transcript>"
    }
  ],
```

- [ ] **Step 4: Update the prompt's `is_compliant` schema line and trailing rules**

In the same response schema, change the line `"is_compliant": <boolean — only meaningful when assessable is true>,` to:

```
  "is_standard": <boolean — true if the transmission met standard phraseology;
    only meaningful when assessable is true>,
```

At the bottom of the prompt, change the two trailing rules:
- `If assessable is false: set is_compliant true, violations [], still populate enrichment fields.` → `If assessable is false: set is_standard true, observations [], still populate enrichment fields.`
- `If compliant: set violations [].` → `If the transmission met standard phraseology: set observations [].`

Leave the `CRITICAL CONTEXT`, `WHAT IS NEVER A VIOLATION`, `MANDATORY READ-BACK ITEMS`, `VIOLATION DECISION FRAMEWORK`, and `SEVERITY DEFINITIONS` sections unchanged — they are the Reasonable Controller Test guardrails and stay verbatim.

- [ ] **Step 5: Update `analyze_batch` to build `Observation`s**

In `analyze_batch`, replace the violations-building block (originally lines 282–296) with:

```python
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
                    ))
                except Exception:
                    continue
```

and replace the `AnalysisResult(...)` construction (originally lines 308–319) so it uses the new field names:

```python
        results.append(AnalysisResult(
            timestamp=item["timestamp"],
            airport_code=item["airport_code"],
            transcript=item["transcript"],
            assessable=assessable,
            assessable_confidence=assessable_confidence,
            is_standard=entry.get("is_standard", entry.get("is_compliant", True)),
            observations=observations,
            summary=entry.get("summary", ""),
            confidence_score=entry.get("confidence_score", 0.5),
            enrichment=enrichment,
        ))
```

(`entry.get("is_standard", entry.get("is_compliant", True))` tolerates a Gemini response that still used the old key during prompt rollout.)

- [ ] **Step 6: Update the `user_message` wording in `analyze_batch`**

Change `Analyze the following {len(items)} ATC transcript(s) for FAA/ICAO compliance.` to:

```python
    user_message = f"""Analyze the following {len(items)} ATC transcript(s) against FAA/ICAO standard phraseology.

{chunks_text}"""
```

- [ ] **Step 7: Reframe `generate_aircraft_report` -> `generate_study_sheet`**

Rename the function and rewrite its prompt to drop investigator/regulator framing:

```python
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
```

- [ ] **Step 8: Verify the module imports**

Run: `python3 -c "from backend.analysis.phraseology import analyze_batch, generate_study_sheet, BATCH_SYSTEM_PROMPT; assert 'observations' in BATCH_SYSTEM_PROMPT and 'is_standard' in BATCH_SYSTEM_PROMPT; print('ok')"`
Expected: `ok`

- [ ] **Step 9: Commit**

```bash
git add backend/analysis/phraseology.py
git commit -m "refactor: compliance.py -> phraseology.py, emit Observations with kind"
```

---

## Task 6: Categorizer and batcher

Update the stats builder's key names and the batcher's imports and field names (§7.4, §10).

**Files:**
- Modify: `backend/analysis/categorizer.py`
- Modify: `backend/core/batcher.py`

- [ ] **Step 1: Update `categorizer.py` imports and docstring**

In `backend/analysis/categorizer.py`, change the import line `from backend.models.schemas import AnalysisResult, SeverityLevel` to:

```python
from backend.models.schemas import AnalysisResult, SignificanceLevel
```

In the module docstring, change "Post-processes AnalysisResult to produce summary statistics, per-airport risk matrix, and violation intelligence" to "...per-airport risk matrix, and phraseology/event intelligence", and "Unassessable results are excluded from compliance rate calculations." to "...from conformance rate calculations."

- [ ] **Step 2: Rename variables and fields inside `build_stats`**

Apply these renames consistently through `build_stats`:

- `non_compliant` → `non_standard`
- `airport_non_compliant` → `airport_non_standard`
- `violation_details` → `note_details`
- loop variable `for v in result.violations:` → `for v in result.observations:`
- `v.severity.value` → `v.significance.value`
- `v.violation_type.value` → `v.note_type.value`
- `if not result.is_compliant:` → `if not result.is_standard:` (both occurrences)

In the returned dict, rename keys:
- `"non_compliant_chunks"` → `"non_standard_chunks"`
- `"compliance_rate"` → `"conformance_rate"`
- `"airport_compliance"` → `"airport_conformance"`
- `"violation_type_details"` → `"note_type_details"`
- in `severity_breakdown`, replace the `SeverityLevel.*` enum keys with `SignificanceLevel.*` keys (`SignificanceLevel.CRITICAL`, `.HIGH`, `.MEDIUM`, `.LOW`)

Rename the local `airport_compliance` dict (built near the end) to `airport_conformance` and update the comment `# Compliance rate excludes unassessable results` to `# Conformance rate excludes unassessable results`.

- [ ] **Step 3: Update `batcher.py` import and field names**

In `backend/core/batcher.py`:

- Change `from backend.analysis.compliance import analyze_batch` to `from backend.analysis.phraseology import analyze_batch`.
- In `_persist_batch`, change `is_compliant=result.is_compliant,` to `is_standard=result.is_standard,` and `violations=[v.model_dump() for v in result.violations],` to `observations=[v.model_dump() for v in result.observations],`.
- In `run_batcher`'s STT-bad branch, change `is_compliant=True,` to `is_standard=True,` and `violations=[],` to `observations=[],`.
- Rename the constant `_VIOLATION_KEYWORDS` to `_NOTABLE_KEYWORDS` and update its one reference inside `_needs_analysis`.

- [ ] **Step 4: Verify both modules import**

Run: `python3 -c "from backend.analysis.categorizer import build_stats; from backend.core.batcher import run_batcher, _needs_analysis; print('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add backend/analysis/categorizer.py backend/core/batcher.py
git commit -m "refactor: rename stats keys and batcher fields for Readback reframe"
```

---

## Task 7: API layer and app title

Update the result/stats/report endpoints and the FastAPI app title (§7.4, §10).

**Files:**
- Modify: `backend/api/results.py`
- Modify: `backend/api/reports.py`
- Modify: `backend/main.py`

- [ ] **Step 1: Update `results.py`**

In `backend/api/results.py`:

- Change the import `from backend.models.schemas import AnalysisResult, Violation` to `from backend.models.schemas import AnalysisResult, Observation`.
- Change `_VALID_STATUSES = {"new", "under_review", "confirmed", "false_positive", "escalated"}` to `_VALID_STATUSES = {"new", "under_review", "confirmed", "false_positive"}`.
- In `_row_to_dict`, change `"is_compliant": r.is_compliant,` to `"is_standard": r.is_standard,`, `"violations": r.violations,` to `"observations": r.observations,`, and `"officer_notes": r.officer_notes,` to `"reviewer_notes": r.reviewer_notes,`.
- In `class ResultUpdate`, rename the field `officer_notes: str | None = None` to `reviewer_notes: str | None = None`.
- In `update_result`, change the `if update.officer_notes is not None:` block to use `reviewer_notes` on both the condition and `row.reviewer_notes = update.reviewer_notes`.
- In `get_stats`, change the `AnalysisResult(...)` construction: `is_compliant=r.is_compliant,` → `is_standard=r.is_standard,` and `violations=[Violation(**v) for v in (r.violations or [])],` → `observations=[Observation(**v) for v in (r.observations or [])],`.

- [ ] **Step 2: Update `reports.py`**

In `backend/api/reports.py`:

- Change the import `from backend.analysis.compliance import generate_aircraft_report` to `from backend.analysis.phraseology import generate_study_sheet`.
- Change the module docstring to `"""Aircraft-level Gemini study sheet, aggregating all transmissions for a callsign."""`.
- Change the route decorator `@router.get("/api/report/{result_id}")` to `@router.get("/api/study-sheet/{result_id}")` and rename the handler `get_aircraft_report` to `get_study_sheet`.
- In the handler, change the `threads` list comprehension field `"is_compliant": r.is_compliant,` to `"is_standard": r.is_standard,`.
- Change `report = await generate_aircraft_report(callsign, threads)` to `study_sheet = await generate_study_sheet(callsign, threads)`.
- Change the return statement to `return {"callsign": callsign, "transmission_count": len(threads), "study_sheet": study_sheet}`.

- [ ] **Step 3: Update `main.py`**

In `backend/main.py`, change the module docstring's first line `ATC Compliance Monitor — application entry point.` to `Readback — application entry point.`, and change `app = FastAPI(title="ATC Compliance Monitor", lifespan=lifespan)` to `app = FastAPI(title="Readback", lifespan=lifespan)`.

- [ ] **Step 4: Verify the whole backend imports**

Run: `python3 -c "import backend.main; print('app ok')"`
Expected: `app ok` (no ImportError, no AttributeError).

- [ ] **Step 5: Verify no stale backend references remain**

Run: `grep -rnE 'is_compliant|officer_notes|\.violations|import.*compliance|generate_aircraft_report|/api/report' backend --include='*.py'`
Expected: no output. (If anything prints, fix it before committing.)

- [ ] **Step 6: Commit**

```bash
git add backend/api/results.py backend/api/reports.py backend/main.py
git commit -m "refactor: update API layer for Readback reframe"
```

---

## Task 8: Frontend — LiveFeed and the two-card split

`LiveFeed.tsx` (1561 lines) renders the analysis cards inline. Update its types, field names, labels, and split the card rendering into a phraseology-note style and a situational-event style. Delete the dead `ViolationCard.tsx` stub.

**Files:**
- Modify: `frontend/src/components/LiveFeed.tsx`
- Delete: `frontend/src/components/ViolationCard.tsx`

- [ ] **Step 1: Delete the dead stub**

Run: `git rm frontend/src/components/ViolationCard.tsx`
(Confirmed dead: the file's only content is a comment and `export {};`.)

- [ ] **Step 2: Update the TypeScript interfaces**

In `LiveFeed.tsx`, update the exported interfaces. Replace the `AnalysisResult` interface fields `is_compliant: boolean;` with `is_standard: boolean;`, `violations: any[];` with `observations: Observation[];`, and `officer_notes?: string;` with `reviewer_notes?: string;`. Add an `Observation` interface above `AnalysisResult`:

```typescript
export type ObservationKind = "phraseology_note" | "situational_event";

export interface Observation {
  kind: ObservationKind;
  note_type: string;
  hfacs_level: string;
  significance: "low" | "medium" | "high" | "critical";
  description: string;
  safety_pathway?: string | null;
  relevant_regulation?: string | null;
  transcript_excerpt?: string | null;
}
```

- [ ] **Step 3: Update `getCardSeverity` and severity references**

In `getCardSeverity`, change `if (!r.violations || r.violations.length === 0) return "compliant";` to `if (!r.observations || r.observations.length === 0) return "standard";` and the loop `for (const v of r.violations)` to `for (const v of r.observations)` with `SEV_ORDER[v.significance]` instead of `SEV_ORDER[v.severity]`.

Rename the `"compliant"` member of the `Severity`/`Filter` union types and the `SEV_BORDER`/`SEV_BG` maps to `"standard"`. Update the `Filter` type's `"compliant"` to `"standard"`.

- [ ] **Step 4: Apply remaining field and label renames in LiveFeed**

Work through the file applying:

- every `.violations` → `.observations`; every `.is_compliant` → `.is_standard`; every `.officer_notes` → `.reviewer_notes`; every `.severity` on an observation → `.significance`; every `.violation_type` → `.note_type`.
- API path: `/api/report/${...}` → `/api/study-sheet/${...}` if present; the report response field `report` → `study_sheet` and `thread_count` → `transmission_count` at any consumer.
- user-facing label strings: "Compliant" → "Standard"; "Violation"/"Violations" → context-dependent: where it lists findings collectively use "Observations"; "compliance" → "phraseology"; "Officer Notes" → "Reviewer Notes"; "Aircraft Report"/"Safety Report" → "Study Sheet".

- [ ] **Step 5: Split the card rendering by `kind`**

Where the card body iterates findings to render them, branch on `kind`: render `kind === "phraseology_note"` findings under a "Phraseology Notes" subheading with an educational/advisory tone (neutral border color, e.g. the existing low/`#44aaff` family), and `kind === "situational_event"` findings under a "Situational Events" subheading. A finding's significance still drives its accent color via the existing `SEV_*` maps. Keep it inline in `LiveFeed.tsx` — do not create separate component files (the surrounding code renders inline; follow that pattern). If the two subsections share markup, extract one local helper function within the file rather than a new module.

Also add the per-card advisory affordance from spec §8: a small, quiet, non-modal info icon (`title`/tooltip, consistent with the dark theme) next to each card's findings, with the tooltip text: `Advisory — transcription may be imperfect and feeds are often one-sided.`

- [ ] **Step 6: Verify the frontend builds**

Run: `cd frontend && npm run build`
Expected: `Compiled successfully` (warnings tolerated; no TypeScript errors).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/LiveFeed.tsx
git commit -m "refactor: LiveFeed types/labels and phraseology/event card split"
```

---

## Task 9: Frontend — StatsPanel, SituationRoom, AirportSidebar, App, index

Apply the terminology and field renames to the remaining frontend files and add the standing advisory line (§8).

**Files:**
- Modify: `frontend/src/components/StatsPanel.tsx`
- Modify: `frontend/src/components/SituationRoom.tsx`
- Modify: `frontend/src/components/AirportSidebar.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/index.tsx`

- [ ] **Step 1: Update StatsPanel stat keys and labels**

In `StatsPanel.tsx`, update every reference to the stats response keys to the new names: `compliance_rate` → `conformance_rate`, `airport_compliance` → `airport_conformance`, `non_compliant_chunks` → `non_standard_chunks`, `violation_type_details` → `note_type_details`. Update user-facing labels: "Compliance Rate" → "Conformance Rate", "Non-Compliant" → "Non-Standard", "Violations" → "Observations", "Violation Types" → "Observation Types". Update any `.severity`/`.violation_type` field access on findings to `.significance`/`.note_type`.

- [ ] **Step 2: Update SituationRoom**

In `SituationRoom.tsx`, apply: `.violations` → `.observations`, `.is_compliant` → `.is_standard`, `.severity` → `.significance`, `.violation_type` → `.note_type` on findings; labels "compliance"/"compliant" → "phraseology"/"standard", "violation(s)" → "observation(s)".

- [ ] **Step 3: Update AirportSidebar**

In `AirportSidebar.tsx`, apply the same label substitutions: "compliance"/"compliant" → "phraseology"/"standard", "violation(s)" → "observation(s)". (28 occurrences — mostly display strings.)

- [ ] **Step 4: Update App.tsx — title, labels, advisory footer**

In `App.tsx`:
- Change the app's displayed title/heading from "ATC Compliance Monitor" to "Readback" (and any subtitle to "ATC phraseology, read back to you").
- Apply label substitutions: "compliance" → "phraseology", "violation(s)" → "observation(s)".
- Add a standing advisory line in the page footer (visible on every page). Use the exact text from spec §8:

```
Readback is an educational tool. Transcriptions may be imperfect and feeds are
often one-sided — notes and events are advisory, not authoritative.
```

Render it as small, muted footer text consistent with the existing dark theme.

- [ ] **Step 5: Update index.tsx and document title**

In `frontend/src/index.tsx`, if a `document.title` is set, change it to "Readback". Also update `frontend/public/index.html` `<title>` and any meta description from "ATC Compliance Monitor" to "Readback" if present.

- [ ] **Step 6: Verify the frontend builds and check for stale terms**

Run: `cd frontend && npm run build`
Expected: `Compiled successfully`.

Run: `grep -rniE 'compliance|violation|officer_notes|is_compliant' frontend/src`
Expected: no output, or only intentional occurrences (e.g. a regulation title quote). Fix anything else.

- [ ] **Step 7: Commit**

```bash
git add frontend/src frontend/public/index.html
git commit -m "refactor: reframe remaining frontend to Readback terminology"
```

---

## Task 10: README and CONTRIBUTING rewrite

Reposition the public-facing docs (§1, §4, §8).

**Files:**
- Modify: `README.md`
- Modify: `CONTRIBUTING.md`

- [ ] **Step 1: Rewrite the README header and intro**

Change the title to `# Readback` with the tagline `> *ATC phraseology, read back to you.*`. Keep the opening KSFO anecdote. Immediately after the tagline/intro, add the advisory statement from §8:

```markdown
> **Readback is an educational tool.** Transcriptions may be imperfect and
> feeds are often one-sided — notes and events are advisory, not authoritative.
> It is for learning and situational awareness, not enforcement.
```

- [ ] **Step 2: Rewrite "Why This Exists"**

Replace the "Why This Exists" section so it leads with the learning and situational-awareness framing: studying phraseology against real traffic, awareness of notable events, and a longitudinal study dataset — not "filling the enforcement gap". Drop the word "compliance"; describe the tool as comparing transmissions to standard phraseology.

- [ ] **Step 3: Replace the violation-category table with two tables**

Replace the single "Violation Categories" table with two tables matching §4:

```markdown
## Phraseology Notes

| Type | Example |
|---|---|
| Read-back Error | Incorrect or missing readback of a cleared altitude |
| Frequency/Channel Error | Frequency confusion, wrong channel |
| Communication Failure | Loss of contact, blocked transmission |
| Navigation Error | Wrong fix or approach named in a transmission |

## Situational Events

| Type | Example |
|---|---|
| Runway Incursion / Excursion | Aircraft enters a runway without clearance |
| Altitude / Speed Deviation | Crew reports leaving a wrong altitude |
| CFIT Risk | Terrain-proximity indications |
| TCAS Event | Crew responds to a resolution advisory |
| Go-around | Missed approach or rejected landing |
| Fuel Advisory | Minimum fuel or fuel emergency declared |
```

- [ ] **Step 4: Update architecture diagram and the rest of the README**

In the architecture ASCII diagram and prose, change "Compliance analysis" / "compliance" → "Phraseology analysis", "violation" → "observation / phraseology note / situational event", "ViolationCard" → "PhraseologyNote / Event rendering". Update the "Key Design Decisions" table wording. Update Quick Start prose if it names the product.

- [ ] **Step 5: Update CONTRIBUTING.md**

Apply the terminology substitutions in `CONTRIBUTING.md`: product name → "Readback", "compliance" → "phraseology", "violation(s)" → "observation(s) / phraseology note(s) / situational event(s)". Keep the bug-reporting, airport-setup, and PR sections structurally intact.

- [ ] **Step 6: Verify no stale terms in docs**

Run: `grep -niE 'compliance monitor|violation' README.md CONTRIBUTING.md`
Expected: no output, or only an intentional reference (e.g. inside a regulation name). Fix anything else.

- [ ] **Step 7: Commit**

```bash
git add README.md CONTRIBUTING.md
git commit -m "docs: reposition README and CONTRIBUTING as Readback"
```

---

## Final verification

After all tasks:

- [ ] **Backend imports clean:** `python3 -c "import backend.main; print('ok')"` → `ok`
- [ ] **Frontend builds:** `cd frontend && npm run build` → `Compiled successfully`
- [ ] **No stale backend terms:** `grep -rnE 'is_compliant|officer_notes|compliance' backend --include='*.py'` → only intentional occurrences (regulation titles), if any
- [ ] **DB migrated:** `python3 -c "import sqlite3; c=sqlite3.connect('atcmonitor.db'); print('observations' in {r[1] for r in c.execute('PRAGMA table_info(analysis_results)')})"` → `True`
- [ ] **Smoke test:** start the backend (`uvicorn backend.main:app`), confirm `/api/results` and `/api/stats` return without error and the JSON uses `observations` / `is_standard` / `conformance_rate`.

---

## Notes / deviations discovered during planning

- The spec (§5, §10) describes splitting `ViolationCard.tsx` into `PhraseologyNoteCard.tsx` + `EventCard.tsx`. In reality `ViolationCard.tsx` is a **dead stub** — card rendering is inline in `LiveFeed.tsx`. Task 8 therefore deletes the stub and does the phraseology/event split *inline* in `LiveFeed.tsx`, consistent with the existing code pattern. This is a faithful realization of the spec's intent (two visually distinct card treatments), not a scope change.
- `/api/report/{id}` has **no current frontend caller** (confirmed by grep). Renaming it to `/api/study-sheet/{id}` is backend-only; Task 8 Step 4 still updates any LiveFeed reference defensively in case one is added.
