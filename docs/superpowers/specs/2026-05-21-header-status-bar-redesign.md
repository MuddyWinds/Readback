# Header Status Bar Redesign

**Date:** 2026-05-21
**Scope:** Visual redesign of the `PipelineStatusStrip` component in `frontend/src/App.tsx` (lines 88–231) and how it is mounted in the header (lines 496–516).

## Problem

The current strip mounted in the header combines three concerns in a way that reads as visually loud and inconsistent with the rest of the UI:

1. A system-wide status indicator (dot + label: `Listening` / `Gemini Down` / `Batch Queued` / `Stopped`).
2. Five airport chips that each (a) show per-feed pipeline stage as inline text (`KJFK · STT`, `KATL · queued N/A`) and (b) act as a selector for the live-feed sidebar / audio / airport filter.
3. An inline audio control (`♪` glyph + `✕` stop) on the chip whose feed is playing.

Issues identified with the user:
- **Too visually loud.** Every chip is its own outlined element in a stage-specific color, with bold/glow on the selected one. This creates rainbow noise in a header that otherwise leans muted (GitHub-dark palette, color used only for severity).
- **Conflates status with selection.** The stage text inside each chip is read-only operational data; the chip itself is interactive. The two channels compete for the same visual real estate.
- **Inconsistent with the header style.** The strip does not match the existing patterns in the same header / the tab+period bar below (pill shapes, `#21262d` tinted-active state, subtle borders).

The user explicitly wants to **keep the per-airport stage signal** — the redesign reduces the visual cost of presenting it, not the information itself.

## Goal

Redesign the strip so that:

- The system status pill is one clearly-separated element, not interleaved with airport controls.
- Airport selectors look and feel like the existing severity-filter pill row (`App.tsx` lines 667–696) — muted text, subtle tint on selected, color reserved for the small leading dot.
- Per-airport stage information is still readable at a glance but uses a simpler 4-color palette instead of 5, with the full stage label moving to a tooltip.
- Errors (Gemini / API / feed-level) surface inside the status pill, not as additional inline chips.

No backend, no API, no data-model changes. This is a pure presentation refactor of one React component.

## Design

### Layout

```
┌─ Header ──────────────────────────────────────────────────────────────────┐
│ ✈ Readback                                                                │
│ ATC phraseology, read back to you                                         │
│                                                                           │
│ ┌──────────────┐  ┌────────────────────────────────────────────┐          │
│ │ ● Listening  │  │  •KJFK   •KATL   •VHHH   •KLAX   •KORD     │          │
│ └──────────────┘  └────────────────────────────────────────────┘          │
└───────────────────────────────────────────────────────────────────────────┘
```

The strip is two sibling groups inside the existing header flex container, in this order:
1. **Status pill** — fixed-content, left side of the strip area.
2. **Airport pill row** — flex-wrapping group of airport pills.

The two groups sit on one line on desktop and wrap as needed on narrower viewports. The existing responsive behaviour (`order` flip on mobile, full-width below title) is preserved — only the inner contents change.

### Status pill

- One element, replaces the current dot + bare `<strong>` label.
- Visual: rounded pill (`border-radius: 6px`), `background: #161b22` (same as header) with a `1px solid #30363d` border, padding `4px 10px`, font-size `12px`.
- Contents: an `8×8` colored dot, then the message text in the dot color.
- The strip is only rendered when `isRunning` (existing condition at `App.tsx:496`), so "Stopped" is not a pill state — when the system is stopped, the strip is hidden entirely.
- States (label → dot color → text color):
  - Listening → `#3fb950` (green) → `#3fb950`
  - Batch Queued → `#58a6ff` (blue) → `#58a6ff`
  - Error states (consolidated below) → `#e3b341` (amber) for soft errors, `#ff4444` (red) for hard errors → matching text color.
- Error handling (replaces the current `apiError || hasGeminiError ? ... : ...` logic):
  - Hard error (red): `apiError` is set (front-end can't reach backend).
  - Soft error (amber): `status.last_gemini_error` set, **or** `status.last_error` set, while `isRunning` is true.
  - Label text uses a short canonical string: `API unreachable`, `Gemini Down`, `Pipeline error`. Full error string from the backend goes into the `title=` tooltip on the pill so it stays inspectable but does not bloat the bar.
- Precedence: hard error > soft error > queued > listening > stopped.

### Airport pill row

- One bordered container holding the pills, mirroring the severity-filter bar pattern (`background: #161b22`, `border: 1px solid #21262d`, `border-radius: 10px`, padding `4px 8px`, inner `gap: 4px`).
- Each airport pill is a `<button>` with:
  - A small `6×6` leading dot (`border-radius: 50%`) whose color comes from the simplified palette below.
  - The airport code (`KJFK`, `KATL`, …) in `12px`, weight `500`, color `#8b949e` (idle) → `#e6edf3` (selected).
  - Padding `4px 10px`, `border-radius: 6px`.
  - Selected state: `background: #21262d`, no border highlight, no glow, no font-weight bump. (Same idiom as the date-period buttons in `App.tsx:446–452`.)
  - Hover state: `background: #1c2026`.
- The `title=` attribute provides the full stage label (`"VHHH — transcribing"`, `"KORD — error: connection refused"`, `"KATL — off"`).

#### Simplified stage palette (replaces `stageColor` in `App.tsx:123–131`)

| State                                          | Dot color       |
| ---------------------------------------------- | --------------- |
| Off / not active                               | `#484f58` grey  |
| `audio` (listening)                            | `#3fb950` green |
| `transcribing` / any `queued_*`                | `#e3b341` amber |
| `error`                                        | `#ff4444` red   |
| `silent` / `too_short` (active but no signal)  | `#8b949e` slate |

Mapping function should be a small helper inside the component (one `switch` or lookup). No callers other than the row render.

#### Audio-playing affordance

The `♪` + `✕` interaction stays functionally identical but is restyled to match the new look:
- When the feed for a pill is the one currently playing:
  - Show a `♪` glyph (`12px`, `#3fb950`) inside the pill, just after the dot — animates with the existing `pulse` keyframe.
  - Show a `✕` glyph (`12px`, `#8b949e`) at the trailing edge of the pill — clicking it calls `onAudioStop` (same `data-audio-stop` delegation pattern as today).
  - The pill background gets a subtle green tint (`#0d1f12`) so it's visibly the audio source, *without* re-introducing heavy borders or glow.
- All other pills (including the selected-but-not-playing one) use the regular pill style.

### Sizing / responsive

- `compact` prop is removed. Sizes are now consistent regardless of header density. Mobile padding/min-height carries over from the existing wrapper.
- The two groups inherit the existing wrapper flex/wrap behavior; no new media queries needed.
- Tooltip is the standard `title=` attribute (no custom tooltip component).

## Implementation notes

- All changes live inside `frontend/src/App.tsx`. No new files.
- Replace the body of `PipelineStatusStrip` with the two-group layout described above. The prop signature stays the same (drop only `compact`); call site in the header (`App.tsx:503–514`) drops the `compact` prop.
- Inline `style={{ … }}` objects remain (matches the rest of the file's pattern). No CSS files, no new dependencies.
- The existing `pulse` keyframe at `App.tsx:746` is reused; no new keyframes needed.

## Out of scope

- Backend changes, new endpoints, new fields on `PipelineStatus`.
- Restyling the rest of the header (title block, Start/Stop buttons, LIVE indicator).
- Restyling the tab+period bar below the header.
- A custom tooltip component — native `title=` is sufficient for now.
- Persisting which airport pill is selected across reloads.

## Testing

- Manual: start all feeds, confirm pills go grey → amber (transcribing) → green (audio) as the pipeline cycles; confirm the selected pill highlights without re-introducing the old glow; confirm playing pill shows `♪` and `✕`, and `✕` stops audio without toggling selection; confirm Gemini error makes the status pill amber with `Gemini Down` and the full error in the tooltip; confirm an `apiError` makes the status pill red.
- Responsive: at mobile breakpoint, the status pill and airport row wrap below the title (existing behavior).
- No automated tests added — this is a presentational change in a file currently without component tests.
