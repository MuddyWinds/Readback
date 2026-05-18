# Readback — Reframe from Compliance Monitor to Phraseology & Situational Awareness Tool

**Date:** 2026-05-18
**Status:** Approved for planning
**Scope:** Reposition the project away from an enforcement-flavored "ATC Compliance Monitor" toward an educational, advisory tool: **Readback** — ATC phraseology learning and situational awareness for enthusiasts, student pilots, and safety researchers. Touches positioning/docs, terminology, the analysis taxonomy, the data model, and the in-flight 2026-04-15 design spec.

---

## 1. Problem Statement

The project is positioned as an "ATC Compliance Monitor" that detects "violations." Three things make that framing fragile and worth changing before more is built on top of it:

1. **It runs against aviation just-culture.** Aviation safety depends on non-punitive reporting (ASRS exists precisely so people report without blame). An automated tool that "flags violations" by identifiable callsigns reads as naming-and-shaming and creates a defamation/liability surface if it ever asserts a specific incident wrongly.
2. **Transcription accuracy cannot support enforcement-grade claims.** Whisper mangles callsigns and digits on compressed ATC audio, and LiveATC feeds are usually one-sided. An LLM "flagging a violation" on a half-heard, mis-transcribed exchange produces false positives that *look* authoritative.
3. **One taxonomy conflates two unlike things.** The current "violation" bucket mixes *"that was phrased non-standardly"* (a teaching point) with *"a go-around just happened"* (an event with no fault). These need different tone and different handling.

The educational and situational-awareness use cases are durable and low-risk. The enforcement framing is the fragile half. This reframe keeps the codebase and steers it toward the durable half.

## 2. Goals

1. Reposition the product as **Readback** — phraseology learning + situational awareness — across docs, UI, and terminology.
2. Split the single "violation" output into two honest, distinct concepts: **Phraseology Notes** (educational) and **Situational Events** (neutral awareness).
3. Rename the data model accordingly, with a migration over the existing `atcmonitor.db`.
4. Constrain identity handling so the tool never publishes aggregate judgments about identifiable operators, while keeping live callsign display (which the 2026-04-15 Aircraft Info page depends on).
5. Add a standing honesty/advisory layer about transcription limits.
6. Bring the in-flight 2026-04-15 design spec into the new vocabulary so the two specs do not diverge.

## 3. Non-Goals

- Renaming the git repository or the `MuddyWinds/atc-monitor` GitHub remote — "compliance" is not in the repo name, so it stays.
- Changing the analysis engine, batching, Whisper pipeline, or ADS-B integration. This is a reframe, not a re-architecture.
- Removing the HFACS taxonomy — it is retained, reframed as an educational "what kind of human factor" lens.
- Building anything from the 2026-04-15 spec (ACO, Aircraft Info page, chatbot). That spec is only *re-termed* here, not implemented.
- Fully de-identifying callsigns in live/operational records — see §6 for the scoped rule.

## 4. The Conceptual Split

The single "violation" concept is replaced by two outputs. Every transcript analysis produces zero or more of each.

| Concept | Definition | Tone | Maps from old categories |
|---|---|---|---|
| **Phraseology Note** | A transmission compared against standard FAA/ICAO phraseology — non-standard phrasing, missing or incorrect readback, frequency confusion | Educational, advisory, "here's how this compares to the book" | Read-back Error, Communication Failure, Navigation Error (phrasing aspects) |
| **Situational Event** | Something operationally notable *observed* — go-around, declared emergency, TCAS RA, runway incursion, minimum/emergency fuel | Neutral awareness, no blame, "heads up, this happened" | Runway Incursion/Excursion, Altitude/Speed Deviation, CFIT Risk, TCAS Non-compliance, Fuel Mismanagement |

Rationale: a mis-transcribed Phraseology Note is a harmless teaching artifact; a Situational Event is just an awareness signal. Neither asserts fault. The split also maps cleanly onto the two halves of the product name (phraseology learning + situational awareness).

The analyzer (Gemini batch call) classifies each finding as one `kind`. The HFACS category is retained on both, as an educational tag.

## 5. Terminology Map

| Old | New |
|---|---|
| ATC Compliance Monitor | **Readback** |
| (tagline) | "ATC phraseology, read back to you." |
| Violation | Phraseology Note **or** Situational Event (per §4) |
| `ViolationCard` (component) | `PhraseologyNoteCard` and `EventCard` |
| Compliance analysis / compliance pipeline | Phraseology analysis |
| `severity: high/medium/low` | `significance: high/medium/low` — levels kept; framed as "how instructive" (notes) / "how notable" (events), not "how bad" |
| Per-aircraft "safety report" | **Session study sheet** |
| "Reasonable Controller Test" | **Kept verbatim** — it is a false-positive guard already aligned with the advisory spirit |
| HFACS classification | Kept; framed as "what kind of human factor" (educational tag) |
| `safety_pathway` field | Kept; framed as the teaching explanation of why phraseology matters |

The word "compliance" is removed from all user-facing copy. "Violation" is removed entirely. "Deviation" is **not** adopted as a replacement — it still implies fault.

## 6. Identity Handling

The risk is not storing a callsign locally (the same audio is public — anyone with a receiver hears it live). The risk is **publishing aggregate judgments about identifiable operators.** The rule targets aggregation and export, not the live record.

- **Live display keeps real callsigns** — the dashboard and the (future) Aircraft Info page show real callsigns while a flight is active. This preserves the 2026-04-15 spec's callsign-keyed ACO, `/aircraft/:callsign` route, and 30-day per-callsign history.
- **No operator-level aggregation, ever** — `StatsPanel` and any statistics group only by airport and note/event type. No airline/operator/controller grouping, ranking, or scorecard. This is a hard rule enforced in the stats queries.
- **The OWN incident corpus pseudonymizes** — when findings feed the searchable corpus described in §10 of the 2026-04-15 spec, callsign and airline are stripped to generic descriptors (e.g. "narrow-body, descent phase"). Corpus records carry no operator identity.
- **Exports pseudonymize** — any dataset export salts and hashes callsigns; raw callsigns never leave the local DB.
- **No persistent operator score** — the "compliance score" concept is dropped. Only per-*session* study metrics exist (on the session study sheet); there is no durable operator scorecard.

## 7. Data Model Changes

**Actual schema (verified against the code):** there is no `violations` table. Findings are stored as a **JSON column** (`violations`) on the `analysis_results` table (`AnalysisResultDB`), each element an embedded `Violation` Pydantic dict. The reframe therefore changes a Pydantic model, one column name, the JSON content of that column, and several scalar fields — not a table.

### 7.1 Pydantic model (`backend/models/schemas.py`)

- `Violation` model → **`Observation`**, gaining a required field `kind: ObservationKind` ∈ {`phraseology_note`, `situational_event`}.
- `Violation.violation_type` → `Observation.note_type`; the `ViolationType` enum → `NoteType` (same members, see §4 mapping for which `kind` each implies).
- `Violation.severity` → `Observation.significance`; the `SeverityLevel` enum → `SignificanceLevel` (same members `low/medium/high/critical`).
- `safety_pathway`, `description`, `relevant_regulation`, `transcript_excerpt` retained unchanged.
- `AnalysisResult.is_compliant` → `is_standard`; `AnalysisResult.violations` → `observations`.

### 7.2 SQLAlchemy model & DB (`backend/db/models.py`, `atcmonitor.db`)

- `AnalysisResultDB.is_compliant` column → `is_standard`.
- `AnalysisResultDB.violations` JSON column → `observations`.
- `AnalysisResultDB.officer_notes` column → `reviewer_notes`.
- `status` column: allowed values drop `escalated` → {`new`, `under_review`, `confirmed`, `false_positive`}.

### 7.3 Migration (`backend/db/migrations/0001_readback_reframe.py`)

A one-shot script run against the existing `atcmonitor.db`. It:

1. Backs up the DB file to `atcmonitor.db.pre-readback.bak`.
2. `ALTER TABLE analysis_results RENAME COLUMN is_compliant TO is_standard` (SQLite ≥ 3.25).
3. `ALTER TABLE analysis_results RENAME COLUMN violations TO observations`.
4. `ALTER TABLE analysis_results RENAME COLUMN officer_notes TO reviewer_notes`.
5. For every row, rewrites the `observations` JSON: for each finding dict, renames `violation_type`→`note_type`, `severity`→`significance`, and adds `kind` derived from `note_type` via the §4 mapping.
6. `UPDATE analysis_results SET status='confirmed' WHERE status='escalated'` (collapse the dropped value).
7. Is idempotent — checks whether `observations` already exists and exits early if so. Prints a row-count + findings-rewritten summary.

The `init_db()` inline-migration block in `backend/db/database.py` is updated to match the new column names so fresh databases and migrated ones converge.

### 7.4 Stats & API

- `categorizer.build_stats`: `compliance_rate` → `conformance_rate`, `airport_compliance` → `airport_conformance`, `non_compliant_*` → `non_standard_*`, `violation_type_details` → `note_type_details`. Aggregation stays keyed by airport and note/event type only (§6) — no operator key is introduced.
- API routes: `/api/results` PATCH body field `officer_notes` → `reviewer_notes`; `_VALID_STATUSES` drops `escalated`; `/api/report/{id}` → `/api/study-sheet/{id}` returning `{callsign, transmission_count, study_sheet}`.
- `generate_aircraft_report()` → `generate_study_sheet()`: prompt rewritten to drop "investigator", "regulator", and "what action a regulator should consider"; reframed as a study sheet (Overview / Phraseology Patterns / Situational Events / Study Suggestions).
- `disputed_examples` (defined in the 2026-04-15 spec, not yet built) is renamed there to `feedback_examples` — see §9. No live table to migrate.

## 8. Honesty / Advisory Layer

- A standing advisory line in the UI footer (present on every page): *"Readback is an educational tool. Transcriptions may be imperfect and feeds are often one-sided — notes and events are advisory, not authoritative."*
- The same statement near the top of the README, immediately after the tagline.
- `PhraseologyNoteCard` and `EventCard` each carry a quiet, non-modal advisory affordance (e.g. an info icon) linking to the same statement.

## 9. Reconciling the 2026-04-15 Spec

The 2026-04-15 spec ("Aircraft Info Page + False-Positive Reduction") is *Approved for planning* but unbuilt. It is saturated with the old vocabulary. It receives a **terminology-only pass** as part of this work — no design changes:

- Title and prose: "Compliance" → "Phraseology"; "violation(s)" → "phraseology note(s)" / "situational event(s)" per §4.
- `ViolationCard` → `PhraseologyNoteCard` / `EventCard`; `Violation` Pydantic model → `Observation` with a `kind` field.
- `disputed_examples` table → `feedback_examples`; `DisputedExample` → `FeedbackExample`; `backend/analysis/few_shot.py` references updated.
- ACO fields `active_violations` / `historical_violations` → `active_observations` / `historical_observations`.
- "Compliance Analyzer", "Compliance Pipeline Upgrade", "compliance.py" prose → "Phraseology Analyzer", "Phraseology Pipeline Upgrade". (The filename `backend/analysis/compliance.py` is renamed to `phraseology.py` as part of this reframe — see §10.)
- A note is added at the top of the 2026-04-15 spec pointing to this spec as the source of vocabulary.

This pass keeps the two specs consistent so future implementation work reads one vocabulary.

## 10. Affected Files (Inventory)

Reframe work, grouped:

- **Docs:** `README.md` (title, tagline, "Why This Exists", architecture diagram labels, violation-category table → two tables, Quick Start), `CONTRIBUTING.md` (terminology), `docs/superpowers/specs/2026-04-15-aircraft-info-page-and-false-positive-reduction-design.md` (terminology pass per §9).
- **Backend:**
  - `backend/models/schemas.py` — `Violation`→`Observation` (+`kind`), `ViolationType`→`NoteType`, `SeverityLevel`→`SignificanceLevel`, `AnalysisResult` field renames.
  - `backend/db/models.py` — `AnalysisResultDB` column renames (§7.2).
  - `backend/db/database.py` — `init_db()` inline migration list updated to new column names.
  - `backend/db/migrations/0001_readback_reframe.py` — new migration script (§7.3).
  - `backend/analysis/compliance.py` → `backend/analysis/phraseology.py` — logic unchanged; `BATCH_SYSTEM_PROMPT` and the JSON response schema updated to emit `kind` and new vocabulary; `analyze_batch()` builds `Observation`; `generate_aircraft_report()`→`generate_study_sheet()`.
  - `backend/analysis/categorizer.py` — stats key renames (§7.4).
  - `backend/core/batcher.py` — import of `phraseology`, `AnalysisResult` field names, comment/var naming, `_VIOLATION_KEYWORDS`→`_NOTABLE_KEYWORDS`.
  - `backend/api/results.py` — `_row_to_dict`/`build_stats` field names, `_VALID_STATUSES`, `ResultUpdate.officer_notes`→`reviewer_notes`.
  - `backend/api/reports.py` — `/api/report/{id}`→`/api/study-sheet/{id}`, calls `generate_study_sheet`.
  - `backend/main.py` — verify router wiring still valid after route renames.
- **Frontend:** `ViolationCard.tsx` → `PhraseologyNoteCard.tsx` + `EventCard.tsx`; `LiveFeed.tsx`, `StatsPanel.tsx`, `SituationRoom.tsx`, `AirportSidebar.tsx`, `App.tsx`, `index.tsx` (labels, API paths `/api/report`→`/api/study-sheet`, field names `is_compliant`→`is_standard`/`violations`→`observations`, footer advisory line).
- **Analyzer prompt:** the `BATCH_SYSTEM_PROMPT` body is updated so the model emits the `kind` classification and uses the new vocabulary; the Reasonable Controller Test, mandatory readback list, and significance ladder are kept verbatim.

## 11. Sequencing

The reframe is documentation- and rename-heavy with one schema migration. Suggested order:

1. **Spec pass** — apply §9 terminology pass to the 2026-04-15 spec. (Pure docs; no risk.)
2. **Data model + migration** — Pydantic/SQLAlchemy renames (§7.1–7.2), migration script (§7.3), run against a copy of `atcmonitor.db`, verify row + findings counts.
3. **Backend rename** — `compliance.py` → `phraseology.py`, analyzer prompt + output schema for `kind`, `analyze_batch`/`batcher` field names, categorizer stat keys, API routes (§7.4).
4. **Frontend rename** — split `ViolationCard`, update API paths, labels, footer advisory.
5. **README + CONTRIBUTING rewrite** — positioning, two-table category section, advisory statement.

Each step is independently verifiable; the migration (step 2) is the only irreversible action and is tested on a DB copy first.

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Migration corrupts existing `atcmonitor.db` | Low | Idempotent script; tested on a copy; original backed up before run; row-count summary printed |
| `kind` mapping mis-buckets an old `violation_type` | Low | §4 mapping table is explicit and exhaustive over current categories; reviewed before migration |
| 2026-04-15 spec drifts from new vocabulary later | Medium | §9 pass plus a pointer note at the top of that spec naming this one as vocabulary source |
| Frontend API-path/field rename misses a caller | Low | Grep for `/api/report`, `is_compliant`, `violations` across `frontend/src`; no backward-compat alias means a missed caller fails loudly |
| `RENAME COLUMN` unsupported (SQLite < 3.25) | Low | Migration asserts `sqlite_version >= 3.25` at start; macOS/Linux ship far newer |
| Reframe perceived as cosmetic only | Medium | The §4 taxonomy split and §6 identity rules are substantive, not cosmetic — they change behavior, not just labels |

## 13. Open Questions for Implementation

- Exact wording of the analyzer prompt section that instructs the model to emit `kind` — drafted during step 3.
- Whether `EventCard` and `PhraseologyNoteCard` share a base component or are fully separate — decided during frontend work based on how much layout they share.
- Whether the footer advisory line is dismissible per-session — default: not dismissible (it is short and low-friction).
