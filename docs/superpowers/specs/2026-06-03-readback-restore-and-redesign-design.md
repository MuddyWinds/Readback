# Restore data-surfacing tabs + redesign the readback comparison

**Date:** 2026-06-03
**Status:** Approved design — ready for implementation planning

## Problem

Two related issues surfaced while reviewing the live feed:

1. **The "Readback comparison" renders in different places on different cards.** It has two
   render sites and the LLM's output decides which one fires:
   - Nested inside a finding row (`ObservationItem.tsx:107`) for whichever finding is the
     `Read-back Error` (`ObservationCard.tsx:298`/`320`). Its vertical position floats with that
     finding's number/ordering.
   - A separately-styled "orphan" note at the top of the Analysis section
     (`ObservationCard.tsx:275`, `showOrphanReadbackNote`) when a readback discrepancy was detected
     but Gemini emitted no matching `Read-back Error` finding.

   Because Gemini non-deterministically may or may not emit that finding, the block jumps between
   the two spots, with different wording and styling in each.

2. **It duplicates the transcript.** The block reprints `ATC:` / `Pilot:` lines
   (`ObservationItem.tsx:110-120`), but the Evidence transcript already renders those exact
   speaker-labelled turns (`StructuredTranscript.tsx:72-82`), which also has a numbered
   excerpt-highlight system already wired in (`excerptMarks` / `activeMark`). The only genuinely
   new information in the block is the discrepancy itself.

3. **"Manual review required" is a dead end.** The low-confidence caveat
   (`ObservationItem.tsx:122`, `ObservationCard.tsx:281`) is passive text with no way to act on it.

4. **The "analysis tab" is gone from `main`.** It was never lost — the Insights tab (plus Review,
   Study, dataset export) lives on the unmerged branch `feat/data-surfacing-phase2`. The reflog
   shows `main` received the settings/findings UI work via `restore/settings-and-findings-ui` but
   never the phase-2 surfaces, so `main` currently has only `live` + `settings` tabs.

## Goals

- Bring the phase-2 tab surfaces (Insights, Review) back into `main` without destabilising the
  current card UI.
- Give the readback comparison one consistent location and stop it duplicating the transcript.
- Make "manual review" actionable by signalling it on the readback row and routing the reviewer to
  the existing result-level status controls / Review tab — without adding a duplicate control.

## Non-goals

- Finishing or shipping the Study tab and dataset export (kept in-tree but hidden).
- Reworking the Insights/Review internals beyond what merge reconciliation requires.
- Adding a finding-level review control or status field — status is result-level and the card
  already has a `StatusWorkflow` + `ReviewerNotes` footer.
- Computing a token-level diff for the readback delta — we use the existing
  `enrichment.readback_discrepancy` text.

---

## Phase A — Restore the data-surfacing tabs

### Approach: full merge, flag-gated surfaces

Merge `feat/data-surfacing-phase2` into `main`, keeping all code and history. Divergence is small:
the merge base is `1d5aad7`, `main` has only 2 commits since the split, and the conflict surface is
4 files.

### Steps

1. **Merge & resolve conflicts** in the 4 overlapping files:
   - `frontend/src/App.tsx` — reconcile the phase-2 tab registry / `TabKey` state with `main`'s
     card-click + airport-tracking handlers (commit `1f33faf`). The `tab` state becomes `TabKey`.
   - `frontend/src/components/livefeed/LiveFeed.tsx`
   - `frontend/src/lib/callsign.ts`
   - `frontend/src/lib/transcript.ts`

   The reworked card components (`ObservationCard`, `ObservationItem`) are **not** touched by
   phase-2, so `main`'s current card UI carries through unchanged.

2. **Flag-gate the Study tab** in `frontend/src/lib/tabs.ts`:
   - Visible: `live`, `insights`, `review`, `settings`.
   - `enabled: false`: `study`.

   `visibleTabs()` already filters on `enabled !== false`, so this is a one-line flag change.

3. **Flag-gate dataset export separately.** Export is **not** a tab — `ExportControls` is a
   subcomponent rendered *inside* `InsightsTab.tsx` (≈line 239), independent of `TABS.study.enabled`.
   Hiding the Study tab does not hide Export. Introduce an explicit feature flag (e.g. an
   `EXPORT_ENABLED` constant alongside the tab registry, default `false`) that `InsightsTab` checks
   before rendering `ExportControls`. This keeps Insights visible while its export affordance stays
   hidden until enabled.

4. **Verify** the merged state:
   - App builds; `tab` state is `TabKey` throughout.
   - Phase-2 tests run green: `TabPeriodBar.test.tsx`, `InsightsTab.test.tsx`, the Review tests.
   - Current card tests still pass: `ObservationCard.test.tsx`, `StructuredTranscript.test.tsx`.

### Already on `main` (not part of the restore)

The result-status infrastructure is **already present** on `main` and must not be re-introduced by
the merge: `StatusWorkflow.tsx`, `ReviewerNotes.tsx`, `ReviewStatus`/`STATUS_LABEL`
(`constants.ts`), `AnalysisResult.status` / `reviewer_notes` (`types.ts:66-67`), and the
`ReportActions` card footer that renders `<StatusWorkflow>` + `<ReviewerNotes>`. Phase A restores
only the **tab surfaces** genuinely missing from `main`: `components/insights/`,
`components/review/`, `components/study/`, and `lib/tabs.ts`.

### Result

Insights ("the analysis tab") and Review are restored; Study and export are present in the tree but
hidden until explicitly enabled.

---

## Phase B — Readback redesign

Uses the result-status infrastructure that already exists on `main`: `AnalysisResult.status`
(`new → under_review → confirmed → false_positive`), `reviewer_notes`, and the `updateResult`
mutation, surfaced today by the card-level `StatusWorkflow` + `ReviewerNotes` in `ReportActions`.

### 1. No transcript duplication

- Remove the `ATC:` / `Pilot:` two-line reprint from `ObservationItem` (`ObservationItem.tsx:110-120`).
- Feed two excerpt marks into the existing `excerptMarks` pipeline — one for the `atc_instruction`
  span and one for the `pilot_readback` span — so those two turns **highlight in the Evidence
  transcript** via the existing `resolveExcerptMarks` / `tokenizeBlock` path.
- **Mark ids live in the `FindingPoint.id` space, not `finding.n`.** The highlight plumbing keys
  `activeMark` off `point.id` (`ObservationCard.tsx:76-79`, row activation at
  `ObservationCard.tsx:301`), and `finding.n` diverges from `point.id` once a finding has subpoints.
  Allocate the two readback marks from the same `nextPointId` counter used for `findingPoints`
  (`ObservationCard.tsx:54-59`), giving them stable ids (`atcMarkId`, `pilMarkId`) with labels
  `ATC` / `PIL`. Record those ids on the anchor row so hovering the row activates both marks and
  hovering either transcript mark activates the row — the same `activate(id, callsign)` path used by
  existing points.
- The finding shows only the **discrepancy delta**, sourced from `enrichment.readback_discrepancy`
  (e.g. *"cleared FL250 → read back FL230"*). The full words live only in the transcript.

### 2. One consistent home: always anchored to a finding row

- The delta always renders **inside a finding row** — never a floating top-of-Analysis note.
- When Gemini emits a `Read-back Error` finding, the delta attaches to it.
- **Orphan case** (discrepancy detected, no matching finding): synthesize one `Observation` and run
  it through the existing pipeline rather than special-casing rendering. Concrete shape:
  - `kind: "phraseology_note"` (so it groups with notes, ahead of situational events).
  - `note_type: "Read-back Error"`.
  - `significance`: `"low"` when `lowConfidence`, else `"medium"` — keeps an unverified, STT-suspect
    readback from outranking confirmed findings under the `bySig` sort.
  - `hfacs_level`: `"unsafe_acts"` (mirrors how real read-back errors are classified); `description`
    = the discrepancy text.
  - `relevant_regulation`, `safety_pathway`, `transcript_excerpt`: omitted/null.
  - **Insertion:** prepend the synthetic observation to `r.observations` **before** `orderedFindings`
    runs, so numbering, grouping, and the `excerptMarks` allocation treat it like any other finding
    and its position is deterministic (first phraseology note). A flag (e.g. `synthetic: true` on the
    observation, or a derived set of synthetic ids) marks it so the row can show the
    `detected · unconfirmed` badge.
  - **Observation count:** the header count (`ObservationCard.tsx:133-137`, `r.observations.length`)
    must exclude synthetic rows — compute it before injection, or subtract synthetics — so a detected
    orphan does not inflate the displayed observation total.
- The low-confidence caveat ("Transcript quality insufficient to verify readback; manual review
  required.") becomes a sub-line on that same anchored row rather than a separate styling.

### 3. Review signal — no new control

Triage stays in the **single existing result-level control**: the `StatusWorkflow` + `ReviewerNotes`
footer that `ReportActions` already renders. The readback row adds **no** mutating buttons (status is
result-level; there is no finding-level status to set, and a second writer on `r.status` would
conflict with the footer).

Instead the readback row carries a passive **`Needs review`** badge when the readback is unconfirmed
or low-confidence — i.e. the orphan synthetic row, or a real `Read-back Error` finding with
`lowConfidence`. The badge is a visual cue only; it does not call `updateResult`. Reviewers act via
the existing footer `StatusWorkflow` (set `confirmed` / `false_positive`) and `ReviewerNotes`, and in
the restored Review tab.

This keeps one writer for `r.status`, avoids duplicate controls, and respects YAGNI — no new
finding-level review surface is introduced.

---

## Data flow (Phase B)

```
enrichment.readback_correct === false && readback_discrepancy
        │
        ▼
build ReadbackComparison { atcInstruction, pilotReadback, discrepancy, lowConfidence }
        │
        ├──► allocate atcMarkId, pilMarkId from the nextPointId counter
        │     excerptMarks += { n: atcMarkId, label: "ATC", excerpt: atcInstruction }
        │                  += { n: pilMarkId, label: "PIL", excerpt: pilotReadback }
        │        → StructuredTranscript highlights the two turns (keyed by point-id)
        │
        └──► anchor row = real Read-back Error finding, OR a synthesized observation
             (kind phraseology_note, prepended before orderedFindings)
                 renders: delta (discrepancy) + lowConfidence caveat (if any)
                          + "Needs review" badge when unconfirmed/low-conf
             (NO mutating buttons — verdicts via the existing StatusWorkflow footer)
```

## Components touched

| Component | Change |
|---|---|
| `lib/tabs.ts` | Flag-gate `study` (`enabled: false`); keep `insights` + `review` enabled. Add `EXPORT_ENABLED` flag (default `false`). |
| `components/insights/InsightsTab.tsx` | Render `ExportControls` only when `EXPORT_ENABLED`. |
| `App.tsx` | `tab` state → `TabKey`; reconcile tab registry with card-click handlers. |
| `ObservationCard.tsx` | Remove orphan note (`275-287`); allocate `atcMarkId`/`pilMarkId` and build the two readback excerpt marks; prepend the synthetic observation for the orphan case (before `orderedFindings`) and exclude it from the header count; pass the readback mark ids / `unconfirmed` flag to the anchor row. |
| `ObservationItem.tsx` | Drop ATC/Pilot reprint (`110-120`); render delta only; show the `Needs review` badge + lowConfidence caveat as a sub-line; wire row hover to activate the readback marks. **No** triage buttons. |
| `ReportActions.tsx` / `StatusWorkflow.tsx` / `ReviewerNotes.tsx` | Unchanged — already on `main`; remain the single triage surface. |

## Testing

**Phase A**
- Merged build passes; `tab` state typed as `TabKey`.
- `TabPeriodBar` shows `live · insights · review · settings`; `study` hidden.
- `InsightsTab` does **not** render `ExportControls` while `EXPORT_ENABLED` is false.
- Phase-2 tests (`TabPeriodBar`, `InsightsTab`, Review) and current card tests both green.
- No duplicate `StatusWorkflow`/`ReviewerNotes` introduced by the merge.

**Phase B**
- Readback finding renders the delta and **does not** reprint ATC/Pilot lines.
- The two readback turns receive excerpt highlights in the transcript; mark ids come from the
  `point.id` space and hovering the anchor row activates both marks (and vice-versa) even when the
  finding has subpoints.
- Orphan case prepends one synthetic `phraseology_note` row flagged `unconfirmed` at the deterministic
  first-note slot — no top-of-Analysis note — and the header observation count is **unchanged**.
- Low-confidence caveat and `Needs review` badge appear on the anchored row.
- The readback row exposes **no** status-mutating buttons; triage remains the card footer
  `StatusWorkflow` / `ReviewerNotes`.

## Risks / open considerations

- **Excerpt matching:** `resolveExcerptMarks` matches excerpt text within transcript blocks. If
  `atc_instruction` / `pilot_readback` are paraphrases rather than verbatim substrings of the
  transcript, the highlight may not resolve. Fallback: if a mark fails to resolve, the delta still
  renders on the finding row (no highlight), so the card degrades gracefully.
- **Synthetic-row significance & sort:** the synthetic observation is sorted by `bySig` like any
  other. Using `low`/`medium` (not `high`/`critical`) keeps an unverified readback from jumping above
  confirmed findings while still landing in the deterministic first-note position. Cover ordering and
  the unchanged observation count with tests.
- **Header count source of truth:** the displayed count uses `r.observations.length`
  (`ObservationCard.tsx:133-137`); since the synthetic row is injected into the finding pipeline, the
  count must be captured before injection (or synthetics subtracted) to avoid drift.
