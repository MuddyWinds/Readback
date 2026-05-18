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

Applied to the existing SQLite `atcmonitor.db` via a one-shot migration script (`backend/db/migrations/0001_readback_reframe.py`).

- **`violations` table → `observations`.**
  - New column `kind TEXT NOT NULL` ∈ {`phraseology_note`, `situational_event`}.
  - `violation_type` → `note_type` (its value also informs `kind` per the §4 mapping).
  - `severity` → `significance`.
  - `safety_pathway` retained, unchanged name.
  - All other columns retained.
- **Migration logic:** existing rows copied into `observations`; `kind` derived from old `violation_type` using the §4 mapping table; `significance` copied from `severity`. Old `violations` table dropped after copy. Migration is idempotent (checks for `observations` existence first) and prints a row-count summary.
- **`disputed_examples`** (defined in the 2026-04-15 spec, not yet built) is renamed in that spec to `feedback_examples` — see §9. No live table to migrate.
- **API:** `/api/violations` → `/api/observations`; dispute endpoint `/api/violations/{id}/dispute` → `/api/observations/{id}/feedback`. No backward-compat alias — pre-release project.

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

- **Docs:** `README.md` (title, tagline, "Why This Exists", architecture diagram labels, violation-category table → two tables, Quick Start), `CONTRIBUTING.md` (terminology), `docs/superpowers/specs/2026-04-15-*.md` (terminology pass per §9).
- **Backend:** `backend/analysis/compliance.py` → `phraseology.py` (logic unchanged, prompt copy and the analyzer's output schema updated to emit `kind`); `backend/analysis/categorizer.py` (category constants → §4 split); `backend/core/batcher.py` (variable/comment naming); `backend/api/*` (route rename per §7); `backend/models/*` (`Violation` → `Observation`); `backend/db/*` (migration script).
- **Frontend:** `ViolationCard.tsx` → `PhraseologyNoteCard.tsx` + `EventCard.tsx`; `LiveFeed.tsx`, `StatsPanel.tsx`, `SituationRoom.tsx`, `AirportSidebar.tsx`, `App.tsx`, `index.tsx` (labels, API paths, footer advisory line); any hooks calling `/api/violations`.
- **Analyzer prompt:** the `BATCH_SYSTEM_PROMPT` body is updated so the model emits the `kind` classification and uses the new vocabulary; the Reasonable Controller Test, mandatory readback list, and significance ladder are kept verbatim.

## 11. Sequencing

The reframe is documentation- and rename-heavy with one schema migration. Suggested order:

1. **Spec pass** — apply §9 terminology pass to the 2026-04-15 spec. (Pure docs; no risk.)
2. **Data model + migration** — `observations` table, migration script, run against a copy of `atcmonitor.db`, verify row counts.
3. **Backend rename** — models, routes, `compliance.py` → `phraseology.py`, analyzer prompt + output schema for `kind`, categorizer split.
4. **Frontend rename** — split `ViolationCard`, update API paths, labels, footer advisory.
5. **README + CONTRIBUTING rewrite** — positioning, two-table category section, advisory statement.

Each step is independently verifiable; the migration (step 2) is the only irreversible action and is tested on a DB copy first.

## 12. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Migration corrupts existing `atcmonitor.db` | Low | Idempotent script; tested on a copy; original backed up before run; row-count summary printed |
| `kind` mapping mis-buckets an old `violation_type` | Low | §4 mapping table is explicit and exhaustive over current categories; reviewed before migration |
| 2026-04-15 spec drifts from new vocabulary later | Medium | §9 pass plus a pointer note at the top of that spec naming this one as vocabulary source |
| Frontend API-path rename misses a caller | Low | Grep for `/api/violations` across `frontend/src`; no backward-compat alias means a missed caller fails loudly |
| Reframe perceived as cosmetic only | Medium | The §4 taxonomy split and §6 identity rules are substantive, not cosmetic — they change behavior, not just labels |

## 13. Open Questions for Implementation

- Exact wording of the analyzer prompt section that instructs the model to emit `kind` — drafted during step 3.
- Whether `EventCard` and `PhraseologyNoteCard` share a base component or are fully separate — decided during frontend work based on how much layout they share.
- Whether the footer advisory line is dismissible per-session — default: not dismissible (it is short and low-friction).
