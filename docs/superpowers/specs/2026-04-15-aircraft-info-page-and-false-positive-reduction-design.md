# Aircraft Info Page + False-Positive Reduction — Design Spec

**Date:** 2026-04-15
**Status:** Approved for planning
**Scope:** Two linked problems — reducing compliance false positives from ATC shorthand misclassification, and adding a third page (Aircraft Info) with rich visuals, scoped chatbot, and linked incident context.

---

## 1. Problem Statement

The ATC Compliance Monitor currently produces a high rate of false-positive violations because Gemini Flash, the compliance analyzer, cannot reliably disambiguate ATC shorthand. Example: "two five zero" can mean FL250, heading 250, or 2,500 ft depending on flight phase, current altitude, and assigned clearance — the analyzer sees only the raw transcript with no grounding. Numeric sequences like "1250 14 7" (a valid wind call of 250°/14G07) are misread as altitudes or headings.

Simultaneously, the app needs a third page showing per-aircraft forensic detail: a toggled interior/exterior visual, airline-specific configuration data, linked incidents that escalate on active violations, and a scoped conversational interface for querying the aircraft, its situation, and correlated historical incidents.

These two problems share a common root cause: the system has no unified, live, per-aircraft context object. The fix for both is the same data spine.

## 2. Goals

1. Reduce false-positive rate on compliance violations by grounding the LLM in deterministic parses and live aircraft state.
2. Add an Aircraft Info page (`/aircraft/:callsign`) reachable from the Monitoring page.
3. Provide a scoped chatbot capable of deep-searching historical incidents across NTSB, ASRS, and the app's own DB.
4. Establish a lightweight feedback loop (user disputes → few-shot injection) that improves the analyzer over time without ML infrastructure.

## 3. Non-Goals (v1)

- True 3D (Three.js) aircraft models — deferred; v1 uses 2.5D SVG schematics.
- Fine-tuning the analyzer model — disputed examples feed few-shot injection; fine-tuning is a future option.
- Cross-corpus deduplication in the incident database.
- Real-time ASRS scraping — monthly refresh only.
- Generative summaries across retrieved incidents in the chatbot.

## 4. Architecture Overview

The design introduces the **Aircraft Context Object (ACO)** — a live, per-callsign record continuously updated from ADS-B, transcripts, and Gemini results. Every new feature is a consumer of the ACO.

```
          ┌─────────────────────────────────────────────────┐
          │             AIRCRAFT CONTEXT OBJECT             │
          │   live, per-callsign, ~10s refresh              │
          │                                                 │
          │  identity · state · clearance · transmissions   │
          │  violations · fleet cfg · maintenance           │
          └──────────────┬──────────────────────────────────┘
                         │
       ┌─────────────────┼──────────────────┐
       ▼                 ▼                  ▼
  ┌─────────┐      ┌──────────┐      ┌──────────────┐
  │Compliance│     │Aircraft  │      │Chatbot       │
  │Analyzer  │     │Info Page │      │(γ hybrid:    │
  │(A+B+D)   │     │(visual + │      │ tools + RAG) │
  │          │     │ details) │      │              │
  └─────────┘      └──────────┘      └──────────────┘
```

High-leverage shifts:

1. **ADS-B becomes a continuous stream writing into the ACO** (not a correlation-at-analysis-time afterthought).
2. **A deterministic normalizer sits in front of the compliance path AND the transcript display.** Every transcript is structured-tagged before the LLM sees it, and before the frontend displays it.
3. **Disputed violations become a first-class DB table**, fed into the Gemini prompt as few-shot examples. No ML infrastructure required.

New backend modules: `backend/context/`, `backend/parsers/`, `backend/corpus/`, `backend/chat/`. New API namespace: `/api/aircraft/{callsign}`. New WebSocket topic: `/ws/aircraft/{callsign}`. Two new frontend surfaces: `AircraftPage` and `ChatFab`.

## 5. Aircraft Context Object (ACO)

**Module:** `backend/context/aco.py`

**Data model (Pydantic):**

```python
class AircraftContext:
    # Identity
    callsign: str                 # "UAL237"
    tail: str | None              # "N2250U"
    icao24: str | None
    aircraft_type: str | None     # "B77W"
    airline: str | None           # "UAL"
    airline_config_key: str       # "UAL-B77W-3class"

    # Live state (refreshed ~10s from ADS-B)
    lat: float; lon: float
    altitude_ft: int
    vertical_speed_fpm: int
    ground_speed_kt: int
    heading_deg: int
    squawk: str
    phase: Literal["ground","taxi","takeoff","climb","cruise",
                   "descent","approach","landing","unknown"]
    on_runway: str | None

    # Expected state (from last parsed clearance)
    assigned_altitude: int | None
    assigned_heading: int | None
    assigned_speed: int | None
    cleared_runway: str | None
    hold_short_of: str | None
    last_instruction_ts: datetime

    # Transmissions (ring buffer, last 20)
    transmissions: list[NormalizedTurn]

    # Compliance
    active_violations: list[Violation]
    historical_violations: list[Violation]  # past 30 days, this callsign

    # Context
    airport_icao: str
    atis_snapshot: ATISData | None          # wind, altimeter, rwy in use
    fleet_config: FleetConfig               # airline-specific
    maintenance_flags: list[str]
```

**Lifecycle:**

- **Create:** when a callsign first appears in either a transcript OR ADS-B traffic for a monitored airport.
- **Refresh:** 10s loop for ADS-B state; on every transcript for transmissions; on every Gemini result for violations.
- **Evict:** 30 min after last sighting — in-memory record dropped.
- **Persist:** continuously mirrored to SQLite (`aircraft_sessions` table) so the Aircraft Info page can read history after eviction.

**API:** `GET /api/aircraft/{callsign}` → current ACO. `WebSocket /ws/aircraft/{callsign}` → push updates as the ACO changes.

## 6. Normalizer (Pre-LLM Parser)

**Module:** `backend/parsers/atc_normalizer.py`

A deterministic regex + grammar parser that converts raw transcripts to structured tokens *before* Gemini sees them. It annotates; it does not replace the LLM.

**Input:** raw transcript string.
**Output:** list of typed tokens with spans, plus ambiguity flags.

```json
{
  "raw": "united two three seven heavy descend and maintain flight level two five zero altimeter two niner niner two wind two five zero at one four gust seven",
  "tokens": [
    {"type":"callsign","value":"UAL237","modifier":"heavy","span":[0,30]},
    {"type":"instruction","verb":"descend_maintain","span":[31,50]},
    {"type":"altitude","value":25000,"form":"FL250","span":[51,75]},
    {"type":"altimeter","value":29.92,"span":[76,105]},
    {"type":"wind","direction":250,"speed":14,"gust":7,"span":[106,145]}
  ],
  "ambiguity_flags": []
}
```

**Token types handled in v1:**

- Callsigns (airline code + flight number + wake modifier)
- Altitudes (FL form, thousands form, transition altitude awareness)
- Headings, speeds, squawks, altimeter settings
- Runway IDs ("two eight right" → "28R")
- Wind / ATIS patterns (anchored against `atis_snapshot`)
- Standard verbs (cleared, climb, descend, maintain, turn, contact, hold short, cross, taxi via, line up)
- Shorthand map loaded from `backend/parsers/shorthand_{airport}.json`

**Out of scope for v1:** intent parsing, readback matching, semantic reasoning — all handled by Gemini downstream.

**Ambiguity handling:** when two parses are possible ("two five zero" could be FL250 or 2500 ft or heading 250), the normalizer emits **all valid parses** as candidates. The compliance analyzer picks based on ACO state.

**Dual-use:** the same normalized tokens are sent to the frontend for the Recent Transmissions section, where hovering a token shows the parse (`FL250 · conf 0.92`). Right-click → dispute writes a row to the disputed-examples table.

## 7. Compliance Pipeline Upgrade

**Modified file:** `backend/analysis/compliance.py`

The existing `run_batcher()` orchestrator in `backend/core/batcher.py` stays. The payload per transcript is expanded:

```json
{
  "index": 0,
  "airport": "KSFO",
  "raw_transcript": "...",
  "normalized": { "tokens": [...], "ambiguity_flags": [...] },
  "aircraft_context": {
    "UAL237": {
      "type": "B77W",
      "phase": "descent",
      "altitude_ft": 12400,
      "assigned_altitude": 10000,
      "assigned_heading": 280,
      "cleared_runway": null,
      "hold_short_of": null,
      "recent_turns": [ /* last 5 normalized */ ]
    }
  },
  "airport_context": {
    "atis": {"wind":"250/14G07","altimeter":29.92,"rwy_in_use":"28R"},
    "active_runways": ["28R","28L","01L"]
  }
}
```

**Prompt changes:** three new sections prepended to `BATCH_SYSTEM_PROMPT`:

1. **Input structure** — explains the three new inputs and tells the model to trust the normalizer over its own interpretation of ambiguous digits.
2. **ACO trust rule** — when the normalizer marks a token ambiguous, pick the candidate consistent with `aircraft_context`.
3. **Few-shot block** — "Previously disputed violations" section, populated dynamically.

The existing prompt body (Reasonable Controller Test, mandatory read-back list, severity ladder) is kept verbatim.

**DisputedExample table:**

```sql
CREATE TABLE disputed_examples (
  id INTEGER PRIMARY KEY,
  transcript TEXT NOT NULL,
  normalized_json TEXT NOT NULL,
  original_verdict TEXT NOT NULL,
  user_reason TEXT,
  created_at DATETIME NOT NULL,
  status TEXT DEFAULT 'disputed',   -- 'disputed' | 'confirmed_fp' | 'reviewed_true_positive'
  airport TEXT,
  aircraft_type TEXT
);
```

**Few-shot selector (`backend/analysis/few_shot.py`):**

- Selects 10 most recent `disputed` / `confirmed_fp` rows.
- Ranks by (a) same airport, (b) same aircraft type, (c) same violation_type.
- Budget: ~2,000 tokens; truncate if exceeded.
- Cached per batch; invalidated on new dispute.

**Frontend dispute flow:**

- Every `ViolationCard` gains a small `👎 False positive` button with optional one-line reason field.
- `POST /api/violations/{id}/dispute` writes a row.
- Immediate UI feedback; next batch picks up the new few-shot row.

**Structural gate (synchronous post-LLM validator):**

Before returning violations to the frontend:

- If `violation_type == "Read-back Error"` but `pilot_readback is null` → drop (one-sided recording hallucination).
- If `violation_type == "Altitude Deviation"` but no `altitude` token in `normalized` → drop.
- If `safety_pathway` < 30 chars or matches filler patterns ("could cause confusion", "may result in issues") → drop.
- Dropped violations logged to a `gate_rejections` table for observability.

## 8. Aircraft Info Page (Frontend)

**Route:** `/aircraft/:callsign`. Top banner shared with Monitoring page.

**Layout (vertical stack):**

```
┌───────────────────────────────────────────────────┐
│ HEADER (shared)                                   │
├───────────────────────────────────────────────────┤
│                                                   │
│               VISUAL PANEL (~55vh)                │
│   [Exterior][Interior]   [front|side|top|cut]     │
│                                                   │
│         SVG schematic / Leaflet map               │
│                                                   │
├───────────────────────────────────────────────────┤
│                                                   │
│               DETAILS PANEL (scroll)              │
│   ▼ Incidents                              (!)    │
│   ▼ Aircraft Type                                 │
│   ▼ Airline Configuration                         │
│   ▼ Maintenance                                   │
│   ▼ Recent Transmissions                          │
│                                    ┌──────────┐   │
│                                    │ 💬 Ask   │   │
│                                    └──────────┘   │
└───────────────────────────────────────────────────┘
```

**Visual panel — top region, user-resizable via divider handle:**

- **Exterior view (default):** Leaflet map with live aircraft position. Rotated rectangle icon, type-colored. Takeoff phase → runway highlighted with animated V1/VR/V2 markers sliding along the runway as the aircraft accelerates. Approach phase → glideslope cone overlay. All data from ACO.
- **Interior view:** 2.5D SVG schematic (Path 2). SVG files live in `frontend/public/aircraft-svg/{type}__{airline}.svg`. Named groups: `#engine-1`, `#engine-2`, `#hydraulic-system-a`, `#hydraulic-system-b`, `#gear-nose`, `#gear-main-l`, `#gear-main-r`, `#elec-main-bus`, `#apu`, `#cabin-fwd-galley`, etc.
- **Interaction:** pan/zoom via CSS transforms; click a group → tooltip with sub-system name. `[3D view — coming soon]` badge acknowledges the future Three.js upgrade without blocking v1.
- **View selector:** 4 pre-rendered angles (front, side, top, cutaway) crossfaded to fake rotation.
- **Violation linkage:** an active violation with `affected_systems: ["hydraulic-system-a"]` gives the corresponding `<g>` a red pulsing stroke + faint red fill. Hover shows the violation summary; click scrolls to Incidents section.

**Details panel — collapsible accordion sections:**

Default order (normal state):

1. Aircraft Type (open)
2. Airline Configuration (open) — with sub-dropdowns `[seats | avionics | electrical | doors | emergency]` sourced from `backend/fleet/{airline}/{type}.yml`
3. Recent Transmissions (open) — last 20 normalized turns, hoverable tokens, right-click → dispute parse
4. Maintenance (collapsed)
5. Incidents (collapsed, count badge)

**Active-violation reconfiguration (Framing Y with aggressive X-escalation):**

- Incidents section animates to position 1, auto-expands, header tinted by severity.
- Top-of-column banner: `⚠ Active violation: Altitude Deviation (high) — 14s ago`.
- SVG affected region flashes 3s then settles into persistent red outline.
- Chatbot FAB pulses red with badge `💬 1` and a violation-specific suggested prompt is queued (e.g. *"Explain what happened with UAL237 and what regulation applies."*).
- Auto-scroll places the affected visual region in view *only if* the user hasn't interacted in the last 3s.

**Incidents section rendering:** each violation is an expandable card with type, severity, timestamp, ATC instruction, pilot readback, safety pathway, regulation cite, and below the body a **"Similar incidents"** list of the top 3 correlation results (built in §10), each linking to NTSB/ASRS source or internal history. Dispute button on every card.

**Chatbot FAB (`ChatFab.tsx`):** fixed bottom-right, 56px icon; expands into a 380×560 panel anchored bottom-right on desktop, full-width bottom sheet (`height: 75vh`) on mobile. Keyboard shortcut `⌘K` to open. Scoped to current callsign.

**Responsive sizing — global requirement:**

- All regions use fluid units (vh/vw, CSS grid `minmax`, flex-basis %).
- Breakpoint tokens in `frontend/src/styles/breakpoints.css`: `--bp-sm: 768px`, `--bp-md: 1200px`, `--bp-lg: 1600px`.
- Visual panel: `min-height: 40vh`, default `55vh`, user-resizable.
- SVG uses `viewBox` + `preserveAspectRatio` — infinite zoom, no quality loss.
- Leaflet `ResizeObserver` refits on container resize.
- Details sections: single column <768px, two columns 768–1200px, three columns >1200px for dense sections.
- Existing pages audited against new breakpoint tokens in Phase 3.

**State management:** one `violationState` React context drives escalation. `useAircraftContext(callsign)` hook subscribes to `/ws/aircraft/{callsign}` and returns a live ACO.

**New components:**

- `AircraftPage.tsx` (route container)
- `VisualPanel.tsx`
- `AircraftDetails.tsx` (accordion container)
- `IncidentsSection.tsx`, `AircraftTypeSection.tsx`, `AirlineConfigSection.tsx`, `MaintenanceSection.tsx`, `TransmissionsSection.tsx`
- `ChatFab.tsx`
- `useAircraftContext(callsign)` hook

**Edits to existing frontend:** Monitoring page aircraft list items become clickable → `navigate('/aircraft/' + callsign)`. No other pages change.

## 9. Chatbot (γ Hybrid)

**Module tree:** `backend/chat/`

```
backend/chat/
├── router.py          # POST /api/chat/{callsign}
├── orchestrator.py    # Gemini tool-calling loop
├── tools/
│   ├── aco_tools.py
│   ├── corpus_tools.py
│   └── reg_tools.py
├── rag/
│   ├── vectorstore.py # Chroma, file-backed
│   ├── embedder.py
│   └── retriever.py
└── scope_guard.py
```

**Tool set (Gemini tool-calling):**

| Tool | Source | Purpose |
|---|---|---|
| `get_aircraft_state(callsign)` | ACO | live position, phase, clearance |
| `get_recent_transmissions(callsign, n=20)` | ACO | normalized turns |
| `get_violations(callsign, include_historical=False)` | ACO + DB | current + past violations |
| `get_fleet_config(airline, type)` | YAML | airline-specific variant |
| `search_incidents(query, aircraft_type?, violation_type?, limit=10)` | Corpus | semantic search across NTSB+ASRS+OWN |
| `deep_correlate(violation_id, max_results=5)` | Corpus | multi-feature correlation |
| `lookup_regulation(section_or_keyword)` | Local reg corpus | FAR, AIM, ICAO Doc 4444 chunks |
| `get_aircraft_type_facts(type, topic)` | Static JSON | specs, V-speeds, systems overview |

**Scope enforcement (two layers):**

1. **Tool contract:** no tool exists for general chat, internet search, celebrities, etc. Without grounded data the prompt forces refusal.
2. **Pre-prompt classifier:** cheap first Gemini call classifies user message into `{aviation_operations, this_aircraft, this_incident, regulation, aircraft_type_knowledge, off_topic}`. On `off_topic` → stock refusal, no tool loop entered.

**Orchestrator loop:**

```python
async def answer(callsign, user_msg, aco):
    if scope_guard.is_off_topic(user_msg):
        return STOCK_REFUSAL
    tools = build_tool_set(aco)
    system_prompt = build_system_prompt(aco)
    messages = [{"role":"user","content":user_msg}]
    for _ in range(MAX_TOOL_HOPS):  # cap 5
        resp = gemini.generate(messages, tools=tools, system=system_prompt)
        if resp.tool_calls:
            for call in resp.tool_calls:
                messages.append({"role":"tool","content": await dispatch(call)})
            continue
        return resp.text
```

**Cost envelope per message:** ~3k input tokens, ~500 output. Under 1¢ on Gemini Flash.

## 10. Incident Corpus

**Module:** `backend/corpus/`

**Unified `IncidentRecord` schema:**

```python
class IncidentRecord:
    id: str                  # "NTSB-20230415-001" / "ASRS-1892345" / "OWN-v391"
    source: Literal["NTSB","ASRS","OWN"]
    date: date
    aircraft_type: str | None
    airline: str | None
    phase: str | None
    location: str | None
    summary: str             # 1–2 sentences
    narrative: str           # full text
    tags: list[str]          # normalized — match violation taxonomy
    severity: str | None
    url: str | None
    embedding: list[float] | None
```

**Ingestion pipelines (`backend/corpus/ingest_{ntsb,asrs,own_db}.py`):**

1. **NTSB:** downloads public NTSB Aviation Accident DB dumps; filters to aviation; field-mapped to `IncidentRecord`; narrative passed through a Gemini Flash tag extractor to produce normalized tags matching the violation taxonomy; embedded; written to Chroma. Monthly refresh via scheduled task. ~20k filtered records.
2. **ASRS:** NASA ASRS CSV quarterly dumps; filtered to "ATC Communications" category; same pipeline. ~15k filtered.
3. **OWN:** reads existing `Violation` rows from `atcmonitor.db`; trigger fires on every new confirmed violation to embed + add to corpus in real-time; tags come directly from HFACS classification.

**Vector store:** Chroma, file-backed, co-located with `atcmonitor.db`. ~500 MB disk budget.

**Embedder:** start with `sentence-transformers/all-MiniLM-L6-v2` (local, free, 384-dim). Fall back to Gemini `text-embedding-004` if retrieval quality is insufficient.

**Deep correlation (`deep_correlate`):**

```python
def deep_correlate(v: Violation) -> list[ScoredIncident]:
    # 1. Vector search over description + safety_pathway
    candidates = vectorstore.search(v.description + " " + v.safety_pathway, k=50)
    # 2. Re-rank by feature overlap
    for c in candidates:
        score = 0.0
        if c.aircraft_type == v.aircraft_type:    score += 0.25
        if c.phase == v.flight_phase:              score += 0.20
        if any(t in c.tags for t in v.tags):       score += 0.20
        if c.violation_type == v.violation_type:   score += 0.15
        score += 0.20 * c.semantic_similarity
        c.final_score = score
    return top_n(candidates, 5)
```

This is used both by the `deep_correlate` chat tool and by the Incidents section's "Similar incidents" cards on the Aircraft Info page (Phase 5 ships value independent of the chatbot).

## 11. Data Flow Summary

1. ADS-B poll loop → ACO.state update.
2. Audio chunk → faster-whisper → transcript string → normalizer → NormalizedTurn → ACO.transmissions (ring buffer) + `transcript_queue` for batcher.
3. `run_batcher()` flush (every 240s) → build per-transcript payload (raw + normalized + ACO snapshot + airport context) → prepend few-shot block → Gemini batch call → parse response → structural gate → persist violations → update ACO.active_violations → push to `/ws/aircraft/{callsign}` and `/ws/live`.
4. User clicks aircraft on Monitoring → `/aircraft/:callsign` → `useAircraftContext(callsign)` subscribes → page renders from live ACO.
5. New violation received over WS → `violationState` context updates → layout reconfigures, SVG group highlights, ChatFab pulses.
6. User disputes a violation → `POST /api/violations/{id}/dispute` → row added to `disputed_examples` → next batch picks it up as few-shot.
7. User opens chatbot, asks question → scope classifier → orchestrator → tool loop → response streamed back.

## 12. Rollout Phases

| Phase | Weeks | Deliverable | De-risks |
|---|---|---|---|
| 1. ACO + Normalizer | 1–2 | Working parser, ACO in-memory + persistence, `/api/aircraft/{callsign}` GET | Normalizer quality on real corpus |
| 2. Compliance upgrade | 3 | New prompt, dispute flow, structural gate, few-shot selector | False-positive reduction measurable before building any page |
| 3. Aircraft page skeleton | 4–5 | Route, layout, sections, WebSocket hook, no SVG/chatbot yet | Y-with-X escalation validated before expensive visuals |
| 4. SVG library + visual linkage | 6–7 | 3 aircraft types × 4 views, `affected_systems` wiring | Scalability of LLM system-tagging |
| 5. Corpus + deep_correlate | 8–9 | NTSB + ASRS + OWN ingestion, "Similar incidents" in Incidents section | Corpus quality before chatbot depends on it |
| 6. Chatbot γ | 10–11 | Scope guard, orchestrator, tool set, FAB wired | — |
| 7. Polish | 12 | Performance audit, 3 more aircraft types, cross-page responsive audit | — |

**Checkpoint after Phase 2:** run new pipeline against the last 2 weeks of existing transcripts. Compare violation count and quality. If not measurably better, stop and diagnose before continuing.

## 13. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Normalizer regex grammar explodes on edge cases | High | Scope to 7 token types in v1; reject unknowns rather than guess; test against real transcript corpus from day 1 |
| ACO drifts from reality (ADS-B + transcript lag) | Medium | Timestamp every field; prompt tells Gemini to treat state as "last known ± 30s" |
| LLM unreliable on `affected_systems` output | Medium | Constrain with enum in schema; structural gate drops unknown systems; start with 8–10 systems |
| SVG commissioning slow/expensive | Medium | Start with 3 types; trace from Wikimedia cutaway diagrams; accept "no schematic" fallback |
| Corpus ingestion disk-heavy | Low | Narrative + fields only, no attachments; ~500MB budget |
| Few-shot pool stale/biased | Low | Cap at 10 recent; rotate; log per-batch selection for audit |
| Chatbot scope guard leaks | Medium | Dual layer (classifier + no off-topic tools); log all refused/answered queries for a week to spot leaks |
| Gemini rate limits worsen with new tool calls | Medium | Raise existing `_MIN_INTERVAL`; separate semaphore for chatbot; cache static tool results |
| Responsive layout regressions on existing pages | Low | Quick audit in Phase 3; centralized breakpoint tokens |

**Biggest single risk:** the normalizer. Phase 1 is deliberately standalone so normalizer failure is caught before anything depends on it.

**Biggest single dependency:** user keeps disputing false positives in real use. Without human labels flowing, few-shot stays empty and the learning loop never activates — which is why the dispute button is one click with optional reason, not a modal.

## 14. Open Questions for Implementation

- Exact shorthand map per airport — populated during Phase 1 from `atcmonitor.db` analysis.
- Which 3 aircraft types get SVG first — chosen from top-seen types in existing DB at start of Phase 4.
- Whether to use SSE or WebSocket for streaming chat responses — decided at Phase 6 start based on existing WS plumbing.
- Whether to move to Gemini embeddings in Phase 5 — depends on observed retrieval quality with MiniLM.
