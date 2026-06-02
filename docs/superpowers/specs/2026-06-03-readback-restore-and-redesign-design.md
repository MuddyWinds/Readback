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

- Bring the phase-2 surfaces back into `main` without destabilising the current card UI.
- Give the readback comparison one consistent location and stop it duplicating the transcript.
- Turn "manual review" into real triage actions that feed the restored Review queue.

## Non-goals

- Finishing or shipping the Study tab and dataset export (kept in-tree but hidden).
- Reworking the Insights/Review internals beyond what merge reconciliation requires.
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

2. **Flag-gate surfaces** in `frontend/src/lib/tabs.ts`:
   - Visible: `live`, `insights`, `review`, `settings`.
   - `enabled: false`: `study`. Gate the dataset-export action behind the same hidden state.

   `visibleTabs()` already filters on `enabled !== false`, so this is a per-tab flag change only.

3. **Verify** the merged state:
   - App builds; `tab` state is `TabKey` throughout.
   - Phase-2 tests run green: `TabPeriodBar.test.tsx`, `InsightsTab.test.tsx`, the Review tests.
   - Current card tests still pass: `ObservationCard.test.tsx`, `StructuredTranscript.test.tsx`.

### Result

Insights ("the analysis tab") and Review are restored; Study and export are present in the tree but
hidden until explicitly enabled.

---

## Phase B — Readback redesign

Built on the Review infrastructure restored in Phase A: a result `status`
(`new → under_review → confirmed → false_positive`), free-text `reviewer_notes`, and the
`updateResult` mutation.

### 1. No transcript duplication

- Remove the `ATC:` / `Pilot:` two-line reprint from `ObservationItem` (`ObservationItem.tsx:110-120`).
- Feed two excerpt marks into the existing `excerptMarks` pipeline — one for the `atc_instruction`
  span and one for the `pilot_readback` span — so those two turns **highlight in the Evidence
  transcript** via the existing `resolveExcerptMarks` / `tokenizeBlock` path. Marks carry the
  readback finding's number; labels distinguish them (e.g. `ATC` / `PIL`).
- The finding shows only the **discrepancy delta**, sourced from `enrichment.readback_discrepancy`
  (e.g. *"cleared FL250 → read back FL230"*). The full words live only in the transcript.

### 2. One consistent home: always anchored to a finding row

- The delta always renders **inside a finding row** — never a floating top-of-Analysis note.
- When Gemini emits a `Read-back Error` finding, the delta + review actions attach to it.
- **Orphan case** (discrepancy detected, no matching finding): synthesize a finding-shaped row
  flagged `detected · unconfirmed`, inserted at a deterministic position in the findings list. This
  replaces the current `showOrphanReadbackNote` block, which is **removed**
  (`ObservationCard.tsx:275-287`).
- The low-confidence caveat ("Transcript quality insufficient to verify readback; manual review
  required.") becomes a sub-line on that same anchored row rather than a separate styling.

### 3. Always-on review actions

Every readback finding row carries triage controls (on confirmed and unconfirmed rows alike):

- **Confirm** → `updateResult({ id: r.id, patch: { status: "confirmed" } })`
- **False positive** → `updateResult({ id: r.id, patch: { status: "false_positive" } })`
- **+ Add note** → reuse the `ReviewerNotes` component, writing `reviewer_notes`.

Wiring: `ObservationCard` owns `r.id` and passes review handlers down to `ObservationItem` for the
readback finding only. Updates are optimistic via the react-query `updateResult` mutation; controls
show a disabled/pending state and revert on failure.

---

## Data flow (Phase B)

```
enrichment.readback_correct === false && readback_discrepancy
        │
        ▼
build ReadbackComparison { atcInstruction, pilotReadback, discrepancy, lowConfidence }
        │
        ├──► excerptMarks += { n, label: "ATC", excerpt: atcInstruction }
        │                  += { n, label: "PIL", excerpt: pilotReadback }
        │        → StructuredTranscript highlights the two turns
        │
        └──► anchor row (real Read-back Error finding, or synthesized "unconfirmed" row)
                 renders: delta (discrepancy) + lowConfidence caveat (if any)
                          + Confirm / False positive / + Add note  → updateResult(r.id, …)
```

## Components touched

| Component | Change |
|---|---|
| `lib/tabs.ts` | Flag-gate `study`; keep `insights` + `review` enabled. |
| `App.tsx` | `tab` state → `TabKey`; reconcile registry with card-click handlers. |
| `ObservationCard.tsx` | Remove orphan note; build the two readback excerpt marks; synthesize the unconfirmed anchor row; pass review handlers + `r.id` down. |
| `ObservationItem.tsx` | Drop ATC/Pilot reprint; render delta only; render always-on review actions + note affordance; lowConfidence caveat as sub-line. |
| `ReviewerNotes.tsx` | Reused (from phase-2) for the note editor. |

## Testing

**Phase A**
- Merged build passes; `tab` state typed as `TabKey`.
- `TabPeriodBar` shows `live · insights · review · settings`; `study` hidden.
- Phase-2 tests (`TabPeriodBar`, `InsightsTab`, Review) and current card tests both green.

**Phase B**
- Readback finding renders the delta and **does not** reprint ATC/Pilot lines.
- The two readback turns receive excerpt highlights in the transcript.
- Orphan case synthesizes one anchored row flagged `unconfirmed` — no top-of-Analysis note.
- Low-confidence caveat appears as a sub-line on the anchored row.
- Confirm → `updateResult` patch `{ status: "confirmed" }`; False positive → `{ status: "false_positive" }`;
  note save → `{ reviewer_notes }`. Pending/disabled state asserted.

## Risks / open considerations

- **Excerpt matching:** `resolveExcerptMarks` matches excerpt text within transcript blocks. If
  `atc_instruction` / `pilot_readback` are paraphrases rather than verbatim substrings of the
  transcript, the highlight may not resolve. Fallback: if a mark fails to resolve, the delta still
  renders on the finding row (no highlight), so the card degrades gracefully.
- **Synthesized row ordering:** the unconfirmed row needs a stable, predictable slot so it doesn't
  reintroduce the "different places" problem. Pick one position (e.g. ahead of phraseology notes)
  and cover it with a test.
