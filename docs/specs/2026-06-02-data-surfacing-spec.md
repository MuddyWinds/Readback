# Readback — Data-Surfacing Spec (Phase 2)

> **Status:** Approved scope, ready for per-feature implementation plans.
> **For agentic workers:** This is a *spec*, not a single executable plan. It covers four
> independent subsystems plus three refactors. Generate one implementation plan per feature
> (using `superpowers:writing-plans`) before touching code. Each feature below is written to
> be buildable on its own and ships working software independently.

**Date:** 2026-06-02
**Author:** (accepted from architecture review)

---

## Context

Readback runs a real-time pipeline — LiveATC → faster-whisper STT → batched Gemini
phraseology analysis → Postgres → WebSocket → React — but exposes only **two screens**:
the **Live feed** and **Settings** (`frontend/src/App.tsx:39`, `tab: "live" | "settings"`).

The data model already captures far more than the UI ever reads back. `AnalysisResultDB`
(`backend/db/models.py:13`) persists a full investigation workflow
(`status`: new→under_review→confirmed→false_positive), `reviewer_notes`, HFACS-classified
`observations`, `enrichment`, and `adsb_snapshot`. The README sells "build a longitudinal
dataset for safety researchers," "per-aircraft study sheets," and instructor/student use
cases — none of which has a real home in the product. **The highest-value work is surfacing
data we already collect, not collecting more.**

This spec delivers four surfaces (Insights, Review queue, Study, Export) and three
refactors that pay for the new surfaces.

### Goals

1. Turn the collected corpus into navigable, aggregated value for the four README personas
   (students, enthusiasts, safety researchers, instructors).
2. Make the existing review workflow (`status`/`reviewer_notes` + `PATCH /api/results/{id}`)
   actually operable.
3. Fix the scaling cliff in study-sheet generation and unify callsign parsing while we add
   the surface that needs it.

### Non-goals

- No change to the ingestion/STT/Gemini pipeline behaviour.
- No authentication/multi-user (single-operator tool today).
- No new external data providers.

---

## Shared technical decisions (apply to every feature)

- **Routing.** The app is a hand-rolled two-value tab switch in `App.tsx`. The first feature
  that lands a third tab MUST introduce real routing first (see **Refactor R1**). All new
  tabs register through that, not through more `tab === "..."` branches.
- **Backend tab pattern.** New API surface = a new router module under `backend/api/`,
  registered in `backend/main.py:40-44` exactly like the existing five
  (`app.include_router(<module>.router)`).
- **Stats reuse.** Aggregation already exists in two places — reuse, do not reinvent:
  - Backend: `build_stats()` (`backend/analysis/categorizer.py:11`) → returns
    `severity_breakdown`, `airport_conformance`, `airport_risk_matrix`, `note_type_details`.
  - Frontend: `frontend/src/lib/analytics.ts` →
    `complianceRate`, `hfacsCounts`, `hourlyActivity`, `detectSpike`, `topNoteTypes`.
- **Migrations.** Schema changes append a step to `MIGRATIONS` in
  `backend/db/migrations/runner.py:43` using `_add_column_if_missing(...)`. Never renumber
  existing version_ids. Migrations run on startup, are idempotent, and work on both Postgres
  and SQLite.
- **Callsign normalization** is canonical in `frontend/src/lib/callsign.ts`
  (`normalizeCallsign`, `isPlausibleCallsign`, `callsignsMatch`). Refactor R2 ports these
  rules to Python so the backend stops using its own ad-hoc regex.
- **Discipline.** TDD per task (red → green → commit). Frequent commits. DRY. YAGNI.
- **Run before claiming done.** `docker compose up -d db` then start backend; `.venv/bin/python -m pytest`
  for backend; `cd frontend && npm test` for frontend.

---

## Feature 1 — Insights / Trends tab  *(highest value)*

### Why

All the aggregation primitives exist, but analytics is buried inside the **per-airport**
sidebar (`AirportAnalytics.tsx`), so the corpus can never be seen as a whole. A dedicated
cross-airport, cross-time tab is the single biggest "purpose gap."

### Requirements

A new top-level **Insights** tab showing, over the currently selected date range
(reuse the existing `DateFilter` from `TabPeriodBar`):

1. **Headline tiles:** total analyzed, assessable, non-standard, overall conformance rate.
2. **Severity breakdown** (critical/high/medium/low) — bar or stacked bar.
3. **HFACS distribution** — counts by `hfacs_level`.
4. **Error-type leaderboard** — top note types with count + dominant airport
   (e.g. "Read-back Error — 42 — KSFO").
5. **Per-airport conformance** — ranked table/matrix (reuse `airport_conformance` +
   `airport_risk_matrix`).
6. **Activity over time** — hourly bins (reuse `hourlyActivity`).

Clicking a leaderboard or airport row deep-links into the Live feed. **The existing
`resolveNavTarget` (`alerts.ts:25`) cannot be reused** — it requires a concrete
`AnalysisResult` (it reads `result.id`/`airport_code`/`getCardSeverity(result)`), which an
aggregate row does not have. Live also has **no note-type filter** today; its filtering only
covers severity + airport (`LiveFeed.tsx:95-98`). Define a separate aggregate-navigation
contract instead:

- **New `AggregateNavTarget`** in `lib/alerts.ts`:
  `{ airportFilter: string; severityFilter: Filter; noteTypeFilter: string | null; sidebarAirport: string | null }`
  (no `resultId` — there's no single card to scroll to).
- **New helper** `resolveAggregateNavTarget({ airport?, noteType? }): AggregateNavTarget`.
  - **Airport row** → `{ airportFilter: code, severityFilter: "all", noteTypeFilter: null,
    sidebarAirport: code }`.
  - **Error-type row** → `{ airportFilter: "all", severityFilter: "all",
    noteTypeFilter: type, sidebarAirport: null }`. **Severity is `"all"`, never a single
    level** — a note type spans multiple severities, so constraining severity would hide
    matching cards. The note type is the constraint.
- **Add a note-type filter to Live.** Thread a `noteTypeFilter: string | null` prop into
  `LiveFeed` and extend the filter at `LiveFeed.tsx:95`:
  `if (noteTypeFilter && !r.observations?.some(o => o.note_type === noteTypeFilter)) return false;`
  `App.tsx` holds the new `noteTypeFilter` state alongside `filter`/`airportFilter` and clears
  it whenever the user changes the severity/airport filters manually.
- A new `navigateToAggregate(target)` in `App.tsx` (sibling to `navigateToResult:58`) applies
  the four fields and switches to the Live tab.

### Backend

`/api/stats` (`backend/api/results.py:115`) already returns the aggregates for items 1–5.
**One gap:** it does not aggregate `hfacs_level` (item 3). Add an `hfacs_breakdown` key to
`build_stats()` output (`backend/analysis/categorizer.py`), counting `v.hfacs_level` across
observations the same way `note_type_details` is built. No new endpoint.

**Item 6 (activity over time) is NOT served by `/api/stats`.** `build_stats` returns only
aggregate buckets — no timestamped bins — and `hourlyActivity` (`analytics.ts:36`) needs the
full `AnalysisResult[]` with timestamps. Do **not** add time-bucketing to `build_stats`
(it would duplicate `hourlyActivity` and force timezone logic onto the server). Instead the
tab computes item 6 **client-side from the `results` array the app already loads** via
`useResults(dateFilter)` (`App.tsx:69`) — the same array `hourlyActivity`/`detectSpike`/
`topNoteTypes` already consume elsewhere. No second backend fetch.

Cap notes (document both in the tab so numbers aren't mistaken for all-time):
- `/api/stats` already limits to the most recent 2000 rows (`results.py:121`) — aggregates
  say "based on most recent N analyses."
- `useResults` is capped at 500 (`get_results` default `limit=500`, `results.py:74`). The
  24-hour `hourlyActivity` window fits comfortably inside recent results; if a future range
  needs more, raise the `useResults` limit for the Insights view rather than time-bucketing
  on the server.

### Frontend

- **Create** `frontend/src/components/insights/InsightsTab.tsx` (+ `.module.css`).
- **Create** `frontend/src/lib/queries.ts` hook `useStats(dateFilter, airport?)` mirroring
  `useResults` (same file already holds `useResults`, `useMonitorStatus`, `usePipelineStatus`).
- Compose existing chart-ish building blocks where they exist (`AirportAnalytics.tsx` has the
  risk-matrix rendering to lift/share); add small presentational subcomponents under
  `components/insights/` rather than growing one file.
- Register the tab via Refactor R1.

### Acceptance criteria

- Insights tab renders sections 1–5 from one `/api/stats` call for the selected range, and
  section 6 (activity over time) from the already-loaded `useResults` array — **no second
  backend fetch dedicated to the chart**. Zero-state copy when empty.
- HFACS section reflects the new `hfacs_breakdown` key (backend test proves it).
- Clicking an **airport** row navigates to Live filtered to that airport (severity "all").
- Clicking an **error-type** row navigates to Live with `noteTypeFilter=type` and severity
  "all"; only cards containing an observation of that note type show. Changing the
  severity/airport filter manually clears `noteTypeFilter`.
- Unit test for `resolveAggregateNavTarget` (both row kinds) and for the new `LiveFeed`
  note-type filter predicate.
- Backend: a `build_stats` unit test asserts `hfacs_breakdown` shape; existing
  `test_results_api.py` still passes.
- Frontend: a unit test for `useStats` + a render test for `InsightsTab` zero-state and
  populated state.

### Representative files
- Modify: `backend/analysis/categorizer.py` (no new router needed)
- Create: `frontend/src/components/insights/InsightsTab.tsx` (+ css), insights subcomponents
- Modify: `frontend/src/lib/queries.ts` (`useStats`), `frontend/src/lib/alerts.ts`
  (`AggregateNavTarget` + `resolveAggregateNavTarget`),
  `frontend/src/components/livefeed/LiveFeed.tsx` (note-type filter prop),
  `frontend/src/App.tsx` (note-type state + `navigateToAggregate`, via R1)
- Test: `tests/test_categorizer_hfacs.py` (new),
  `frontend/src/lib/alerts.test.ts` (extend), `frontend/src/components/insights/InsightsTab.test.tsx`

---

## Feature 2 — Review / Triage queue  *(high value, low effort)*

### Why

The investigation workflow is fully modeled and `PATCH /api/results/{id}` is live
(`backend/api/results.py:96`), with `StatusWorkflow.tsx`, `ReviewerNotes.tsx`, and
`ReportActions.tsx` already built. What's missing is the *inbox*. Today the only way to
triage is to scroll the live feed and hope.

### Requirements

A new **Review** tab presenting a worklist:

1. Default filter `status = "new"`, with chips to switch to `under_review`, `confirmed`,
   `false_positive`, or all.
2. One row/card per result showing transcript excerpt, airport, severity, summary, and the
   existing `StatusWorkflow` + `ReviewerNotes` controls inline.
3. **Keyboard triage:** `j`/`k` move selection, `c` confirm, `x` false-positive,
   `u` under-review, `e` focus notes. Each action calls the existing PATCH endpoint and
   advances to the next item.
4. A small progress indicator ("12 new remaining").

### Backend

`GET /api/results` already accepts `airport` and `start_date`. Add an optional `status`
query param (`backend/api/results.py:73`) filtering `AnalysisResultDB.status`. Validate it
against the existing `_VALID_STATUSES` set already defined at `results.py:20`. No new
endpoint; PATCH is unchanged.

### Frontend

- **Create** `frontend/src/components/review/ReviewQueue.tsx` (+ `.module.css`) and a
  `ReviewRow.tsx` that reuses `StatusWorkflow`, `ReviewerNotes`, `ReportActions`,
  `ConfidenceBadge`, `SectionLabel` from `components/livefeed/`.
- **Create** hook `useReviewQueue(status)` in `lib/queries.ts`. **It MUST use a query key in
  the `["results", ...]` family** (e.g. `["results", { status }]`) so the existing
  `useUpdateResult` `onSuccess` invalidation of `["results"]` (`queries.ts:96`) refreshes the
  queue automatically — do not invent a second, separately-keyed cache that the mutation
  wouldn't touch.
- **Mutation contract (resolves the StatusWorkflow gap).** `StatusWorkflow`
  (`StatusWorkflow.tsx:14`) currently owns its mutation and exposes no success hook, so a
  mouse status change cannot trigger "advance to next." Fix as part of F2:
  - Add an optional prop `onChanged?: (next: ReviewStatus) => void` to `StatusWorkflow`,
    called after `updateResult.mutateAsync` resolves (`StatusWorkflow.tsx:23`). Existing
    call sites omit it — behaviour unchanged.
  - `ReviewRow` passes `onChanged` to advance selection / move the row.
  - **Keyboard** shortcuts (`c`/`x`/`u`) call `useUpdateResult().mutateAsync` directly, then
    advance — same mutation/cache path as the mouse, not a parallel one.
- Register the tab via Refactor R1.

### Acceptance criteria

- Review tab lists only `status=new` by default; chips re-filter without a full reload.
- Keyboard shortcuts perform the correct PATCH (via `useUpdateResult`) and advance selection;
  mouse controls fire the same mutation and trigger `onChanged` so the queue advances too.
- After confirming/dismissing — by mouse *or* keyboard — the item leaves the `new` list and
  the remaining count decrements (proves the shared `["results"]` cache invalidation works).
- Adding `onChanged` to `StatusWorkflow` leaves all existing live-feed call sites unchanged
  (existing `StatusWorkflow`/`ObservationCard` tests still pass).
- Backend: `test_results_api.py` extended to assert `?status=` filters correctly and rejects
  invalid values (reuse `_VALID_STATUSES`).
- Frontend: render + interaction test for keyboard triage advancing selection and firing PATCH.

### Representative files
- Modify: `backend/api/results.py`
- Create: `frontend/src/components/review/ReviewQueue.tsx` (+ css), `ReviewRow.tsx`
- Modify: `frontend/src/lib/queries.ts`, `frontend/src/components/livefeed/StatusWorkflow.tsx`
  (add optional `onChanged`), `frontend/src/App.tsx` (via R1)
- Test: `tests/test_results_api.py` (extend), `frontend/src/components/review/ReviewQueue.test.tsx`

---

## Feature 3 — Persisted callsign + Study / Learning page  *(refactor + add, two-for-one)*

### Why

`GET /api/study-sheet/{id}` (`backend/api/reports.py:37`) loads **every row** in the table
and substring-filters in Python on each request — O(all history) per call — using a naive
regex (`reports.py:19`) that duplicates the better `frontend/src/lib/callsign.ts` logic.
This both scales badly and forks callsign parsing. Fixing it unlocks a real Study surface.

> Depends on **Refactor R2** (Python callsign normalizer). Build R2 first.

### Data model

- Add column `analysis_results.callsign` (`VARCHAR(16)`, nullable, indexed) to
  `AnalysisResultDB` (`backend/db/models.py:13`).
- Append migration `0005_callsign_column` to `MIGRATIONS` (`backend/db/migrations/runner.py:43`):
  `_add_column_if_missing(c, "analysis_results", "callsign", "VARCHAR(16)")`, then a second
  step `0006_callsign_index` creating an index on it
  (`CREATE INDEX IF NOT EXISTS ix_analysis_results_callsign ON analysis_results (callsign)`).
- **Populate at write time:** in `backend/core/batcher.py:128` add
  `callsign=extract_callsign(item["transcript"])` to the `AnalysisResultDB(...)` constructor,
  using the R2 helper (which already normalizes its result, so write-time and read-time keys
  match).
- **Backfill:** a one-time idempotent migration step `0007_callsign_backfill` that fills
  `callsign` for existing rows where it is NULL (iterate, extract, normalize). Safe to re-run.

### Backend

Rewrite `get_study_sheet` (`backend/api/reports.py:27`):
1. Load the subject row; if it has no stored `callsign`, derive one on the fly (don't 500).
2. Query related rows with `select(AnalysisResultDB).where(AnalysisResultDB.callsign == cs)
   .order_by(AnalysisResultDB.timestamp)` — indexed, not a full scan.
3. Add `GET /api/study-sheet/by-callsign/{callsign}` so the Study page can request a sheet
   directly by (normalized) callsign without first knowing a result id.
4. Add `GET /api/callsigns` → distinct non-null callsigns with transmission counts, for the
   Study page picker (`select(AnalysisResultDB.callsign, func.count()).group_by(...)`).

Keep `generate_study_sheet` (`backend/analysis/phraseology.py`) unchanged.

### Frontend

A new **Study** tab:
1. Picker: searchable list of callsigns (from `/api/callsigns`) with counts; optional filter
   by error category (reuse `note_type` values).
2. On select: fetch `/api/study-sheet/by-callsign/{cs}`, render the generated study sheet,
   the aggregated transmissions timeline, and the implicated regulation text
   (reuse `frontend/src/lib/regs.ts`).
- **Create** `frontend/src/components/study/StudyTab.tsx` (+ css), `CallsignPicker.tsx`.
- **Create** hooks `useCallsigns()` and `useStudySheet(callsign)` in `lib/queries.ts`.
- Register the tab via Refactor R1.

### Acceptance criteria

- New rows persist a normalized `callsign`; backfill fills historical rows; migrations are
  idempotent (re-running startup twice is a no-op).
- `get_study_sheet` issues an indexed equality query (no `select(AnalysisResultDB)` over the
  whole table) — assert via a test that inserts rows under two callsigns and confirms only
  the matching ones are aggregated.
- `/api/callsigns` returns distinct callsigns with correct counts.
- Study tab: pick a callsign → see its study sheet, transmissions, and regulation.
- Backend tests: callsign persistence on write, backfill correctness, indexed study query,
  `/api/callsigns` shape.
- Frontend: render test for StudyTab populated + empty.

### Representative files
- Modify: `backend/db/models.py`, `backend/db/migrations/runner.py`, `backend/core/batcher.py`,
  `backend/api/reports.py`
- Create: `frontend/src/components/study/StudyTab.tsx` (+ css), `CallsignPicker.tsx`
- Modify: `frontend/src/lib/queries.ts`, `frontend/src/App.tsx` (via R1)
- Test: `tests/test_callsign_persistence.py`, `tests/test_study_sheet.py` (new/extend),
  `frontend/src/components/study/StudyTab.test.tsx`

---

## Feature 4 — Dataset export  *(cheap, fills a stated promise)*

### Why

The README promises a "longitudinal dataset for safety researchers," but the only egress is
paginated JSON shaped for the live UI. A filtered export delivers that promise directly.

### Backend

Add `GET /api/export` (new router `backend/api/export.py`, registered in `main.py`):
- Query params mirror `/api/results`: `airport`, `start_date`, plus `status` (from F2) and
  `format` (`csv` | `json`, default `csv`).
- Stream the result with FastAPI `StreamingResponse` and a
  `Content-Disposition: attachment; filename="readback_<range>.csv"` header.
- CSV columns: `id, timestamp, airport_code, callsign, assessable, is_standard, status,
  severity_max, note_types, summary, transcript`. Reuse `_row_to_dict` /
  `_safe_observations` from `results.py` for the observation flattening; compute `severity_max`
  and `note_types` from observations (reuse `getCardSeverity` logic's backend equivalent —
  or derive from `v.significance` in `_safe_observations` output).
- No pagination cap for export, but `LIMIT` defensively at e.g. 50000 with a documented note.

### Frontend

- Add an **Export** action (button + tiny format/range menu) on the Insights tab header
  (no separate tab needed). It hits `/api/export` with the current `DateFilter`/airport and
  triggers a browser download.
- **Create** helper `exportUrl(params)` in `frontend/src/lib/api.ts` (which already centralizes
  `API_BASE` + `fetchJson`).

### Acceptance criteria

- `GET /api/export?format=csv` returns a CSV with the documented header row and one row per
  result, respecting `airport`/`start_date`/`status` filters.
- `format=json` returns the array form.
- Download button on Insights produces a file named for the active range.
- Backend test: CSV header + row count match inserted fixtures under filters; invalid
  `format` rejected.

### Representative files
- Create: `backend/api/export.py`
- Modify: `backend/main.py`, `frontend/src/lib/api.ts`, `frontend/src/components/insights/InsightsTab.tsx`
- Test: `tests/test_export_api.py`

---

## Refactors (enabling work)

### R1 — Introduce routing  *(do first, before any new tab)*

`App.tsx` switches on `tab: "live" | "settings"`. Adding three more tabs through
`tab === "..."` branches would bloat an already-large component.

- Introduce a route/tab registry. Lightweight option: extend the existing `tab` union to a
  string keyed off a `TABS` config array and render via a small `switch`/map, keeping current
  state-lifting intact. Heavier option: adopt `react-router` — only if the team wants URL
  deep-linking (which also improves the F1/F2 deep-links and shareable Study links).
- Update `TabPeriodBar` (`components/app/TabPeriodBar.tsx`) to render tabs from the registry.
- **Decision needed from maintainer:** lightweight registry vs. react-router (see open
  question Q1). Default to the lightweight registry unless URL deep-linking is wanted.

**Acceptance:** existing Live + Settings tabs work unchanged; adding a tab is one registry
entry; `TabPeriodBar` render test covers the registry.

### R2 — Unify callsign parsing into Python

There are **three** callsign implementations today, and porting only `callsign.ts` would
leave backend extraction *weaker* than the frontend's:

1. `frontend/src/lib/callsign.ts` — **normalization** (`normalizeCallsign`,
   `isPlausibleCallsign`, `callsignsMatch`). Conservative; never invents a flight.
2. `frontend/src/lib/transcript.ts` — **phonetic-aware extraction** (`extractCallsign:33`,
   `phoneticExpand:15`, `CALLSIGN_REGEX:12`, `AIRLINE_ICAO:5`, `PHONETIC_DIGIT:1`). This is
   the real extraction logic: it expands "cathay two five zero" → `CPA250` before matching.
3. `backend/api/reports.py:19` — an ad-hoc `_CALLSIGN_RE` regex with **no** phonetic
   expansion. This is what study-sheet aggregation uses today, so it under-matches.

They also **diverge on N-numbers**: `transcript.ts` `CALLSIGN_REGEX` uses `N\d{4,5}` while
`callsign.ts` `isPlausibleCallsign` accepts `N\d{1,5}`.

**Scope: port both extraction *and* normalization to `backend/core/callsign.py`**, so the
backend (study-sheet aggregation in F3) matches frontend grouping:
- `normalize_callsign(cs) -> str | None` — port `callsign.ts` `normalizeCallsign` rules
  (`callsign.ts:7-13`): trim/upper, strip spaces & dashes, strip leading zeros from the
  trailing numeric block, N-numbers pass through.
- `is_plausible_callsign(cs) -> bool` — port `callsign.ts:41`.
- `phonetic_expand(text) -> str` and `extract_callsign(text) -> str | None` — port
  `transcript.ts` `phoneticExpand` + `extractCallsign` (airline-word→ICAO map, number-word→
  digit map, space collapsing), returning the first plausible callsign. `extract_callsign`
  should run `normalize_callsign` on its result so write-time (`batcher.py`, F3) and
  read-time produce the same key.
- **Reconcile the N-number regex divergence — decision required (Q5):** standardize both
  frontend and backend on one form. Default: the broader `N\d{1,5}[A-Z]{0,2}` from
  `isPlausibleCallsign`, updating `transcript.ts CALLSIGN_REGEX` to match so frontend and
  backend agree. Capture the chosen form in a shared comment in both files.
- Replace the `_CALLSIGN_RE`/`_extract_callsign` usage in `backend/api/reports.py` with the
  new module; delete the old regex.

**Frontend duplication (Q4):** `callsign.ts` (normalization) and `transcript.ts` (extraction)
remain two TS modules used in the browser. R2 does **not** force-merge them — but flag whether
to consolidate `transcript.ts`'s extraction into `callsign.ts` so the frontend also has a
single callsign module. Default: leave the TS split, keep the Python port faithful to both.

**Acceptance:**
- `tests/test_callsign.py` mirrors the cases proven in **both** `callsign.test.ts` and
  `transcript.test.ts`: normalization (`"AAL 0123"`→`"AAL123"`, `"N123AB"` pass-through,
  bare `"273"` rejected) **and** phonetic extraction (`"cathay two five zero"`→`CPA250`).
  **Out of scope:** NATO letter-word expansion ("november…alpha bravo" → N-number). The
  frontend extractor being ported does *not* do this — `phoneticExpand` maps only airline
  words + digit words (`transcript.ts:1-11`), and `CALLSIGN_REGEX` expects already-compact
  N-numbers. The Python port matches the frontend exactly, no more. (If NATO-letter
  extraction is wanted later, it's a separate change to **both** frontend and backend, out of
  this spec.)
- Backend `extract_callsign` and frontend `extractCallsign` return the same normalized key
  for a shared fixture set (parity test — same inputs listed in both test suites).
- `reports.py` imports from `backend/core/callsign.py`; the old regex is gone.
- If Q5 default is taken, `transcript.ts CALLSIGN_REGEX` is updated and `transcript.test.ts`
  still passes.

### R3 — Aggregate proximity/conflict events (optional, ride-along with F1)

`frontend/src/lib/conflicts.ts` computes separation-loss/proximity per card from
`adsb_snapshot` but nothing aggregates it. If F1 lands, add a derived metric on the Insights
tab: count of proximity/separation events over the range, computed client-side by running
`conflicts.ts` over results that carry an `adsb_snapshot`.

**This requires a backend change — `adsb_snapshot` is NOT in the results payload.**
`_row_to_dict` (`backend/api/results.py:41-56`) omits it, and the UI fetches snapshots
per-id via `/api/adsb-snapshot/{id}` (`PositionSnapshot.tsx:34`). Per-id fetching across a
whole range is N calls — unworkable for an aggregate. Pick one:
- **(a, preferred)** Add a dedicated `GET /api/adsb-snapshots?start_date=&airport=` that
  returns `{result_id, adsb_snapshot}` for rows in range that have one — keeps the main
  `/api/results` payload lean.
- **(b)** Add `adsb_snapshot` to `_row_to_dict`. Simpler, but inflates every results payload
  (and the live feed already pulls 500 rows) — rejected unless (a) proves too heavy.

**Acceptance:** Insights shows "N proximity events" matching a unit test over fixture
snapshots; a backend test covers the new snapshots-in-range endpoint. **Skip R3 entirely if
F1 scope is tight** — it is the lowest-priority item and the only one needing extra backend
surface.

---

## Build sequencing

1. **R1 (routing)** — unblocks every tab. Small.
2. **F1 (Insights)** — highest value; only needs `hfacs_breakdown` + the tab. (R3 optional here.)
3. **F2 (Review queue)** — independent; only needs `?status=` param + tab.
4. **R2 (Python callsign)** — prerequisite for F3.
5. **F3 (callsign column + Study)** — depends on R2; includes migration + backfill.
6. **F4 (Export)** — depends on F1 (button lives on Insights) and benefits from F2's
   `?status=` and F3's `callsign` column; build last.

F1, F2 are parallelizable after R1. F3, F4 follow.

---

## Open questions (resolve before R1/F3)

- **Q1 (R1):** Lightweight tab registry, or adopt `react-router` for real URLs + shareable
  deep-links to Insights/Study? Default: lightweight registry.
- **Q2 (F3 backfill):** Run the callsign backfill as a migration step (blocks startup until
  done) or as a lazy/background fill? Default: migration step, since the table is
  hobby-scale.
- **Q3 (F4 limit):** Acceptable export row ceiling. Default: 50000 with a documented note.
- **Q4 (R2 frontend dedup):** Consolidate `transcript.ts`'s extraction into `callsign.ts` so
  the frontend has a single callsign module, or leave the TS split? Default: leave the split,
  keep the Python port faithful to both.
- **Q5 (R2 N-number regex):** Standardize frontend + backend on one N-number form. Default:
  the broader `N\d{1,5}[A-Z]{0,2}` from `isPlausibleCallsign`, updating `transcript.ts`'s
  `CALLSIGN_REGEX` to match.

---

## End-to-end verification (per feature, before claiming done)

1. `docker compose up -d db` (Postgres is the single source — never the SQLite override).
2. Backend: `.venv/bin/python -m pytest` — all green, including the new tests above.
3. Frontend: `cd frontend && npm test` — all green.
4. Manual: `.venv/bin/python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload`
   + `cd frontend && npm run dev`, open http://localhost:3000, and exercise the new tab/flow
   against real persisted data.
