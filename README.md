# Readback

> *ATC phraseology, read back to you.*

<img width="1600" height="1247" alt="image" src="https://github.com/user-attachments/assets/e37a9a23-8e5a-4078-aaa5-4bd939b5da00" />

> *"I was parked at the threshold of 28R at KSFO, listening to the tower frequency on my handheld, when I heard something that didn't sound right — a clearance that seemed to conflict with another aircraft still on the runway. By the time I processed it, the controller had already issued a go-around. I wished I had something that could catch those moments automatically, log them, and tell me exactly what regulation was implicated."*

> **Readback is an educational tool.** Transcriptions may be imperfect and
> feeds are often one-sided — notes and events are advisory, not authoritative.
> It is for learning and situational awareness, not enforcement.

This project exists because radio communications between pilots and air traffic controllers are dense, fast, and consequential. **Readback** listens to live ATC audio streams, transcribes them in real time, and uses AI to compare transmissions against FAA/ICAO standard phraseology — surfacing read-back errors, non-standard calls, and situational events so you can learn from them.

Built for aviation enthusiasts, safety researchers, student pilots, and anyone who finds themselves glued to LiveATC on a Saturday afternoon.

---

## What It Does

- Streams live audio from [LiveATC.net](https://www.liveatc.net) feeds (or any compatible MP3 stream)
- Transcribes ATC communications using [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (local, no cloud STT cost)
- Batches transcripts and sends them to **Gemini Flash** for phraseology analysis every 4 minutes
- Applies the *Reasonable Controller Test* — notes genuine deviations, ignores transcription noise and one-sided readback gaps
- Classifies observations using **HFACS taxonomy** (Human Factors Analysis and Classification System)
- Correlates findings with live **ADS-B traffic** from OpenSky Network
- Pulls **METAR weather**, **NOTAMs**, and **SIGMET/AIRMET/PIREP** hazards for full situational context
- Streams results live to a React dashboard via WebSocket
- Generates **per-aircraft study sheets** aggregating all transmissions for a callsign

---

## Why This Exists

Standard ATC monitoring tools show you what is happening — radar returns, frequency activity, flight strips. They don't tell you *whether what was said matched standard phraseology*. Readback fills that gap:

- **Student pilots** can study phraseology against real-world examples and see where actual transmissions depart from the book
- **Enthusiasts** can monitor their home airport and get notified of notable events (emergencies, go-arounds, TCAS RAs)
- **Safety researchers** can build a longitudinal dataset of phraseology observations at specific airports
- **Instructors** can use real-world clips to illustrate what a read-back error or non-standard clearance sounds like in practice

---

## Architecture

```
LiveATC Stream (MP3)
        │
        ▼
  ffmpeg chunker          chunks every N seconds
        │
        ▼
 faster-whisper           local STT, confidence-gated
  (WhisperModel)          rejects low-quality audio
        │
        ▼
 transcript_queue         asyncio queue, shared across airports
        │
        ▼
   run_batcher()          drains queue every 4 minutes
        │                 caps at 15 transcripts per batch
        ▼
  Gemini Flash            single API call covering all airports
  (batch analysis)        applies FAA/ICAO/HFACS rules
        │
        ├──► OpenSky ADS-B    correlate traffic at analysis time
        │
        ▼
    PostgreSQL             persist results + ADS-B snapshots
        │
        ▼
  WebSocket /ws/live       broadcast to all connected clients
        │
        ▼
   React Dashboard
   ├── AirportSidebar      select/manage monitored airports
   ├── LiveFeed            real-time transcript + observation stream
   ├── StatsPanel          aggregate phraseology statistics
   ├── PhraseologyNote /   per-observation detail + HFACS category
   │   Event rendering
   └── SituationRoom       unified ops view with weather + NOTAMs
```

### Key Design Decisions

| Decision | Reason |
|---|---|
| Batch Gemini calls (4-min window) | Conserves free-tier daily quota; one call covers all airports |
| Local Whisper STT | No per-minute STT cost; runs on CPU with int8 quantisation |
| Confidence gating before AI call | Avoids sending garbage transcripts to Gemini; saves tokens |
| ADS-B snapshot at analysis time | Correlates what was *said* with what aircraft were *actually doing* |
| HFACS taxonomy | Industry-standard classification used in NTSB/ASRS investigations |

---

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

---

## Quick Start

### Prerequisites

- Docker + Docker Compose
- `ffmpeg` — `brew install ffmpeg` (Mac) or `apt install ffmpeg` (Linux)
- [Gemini API key](https://aistudio.google.com/app/apikey) (free tier works)

### 1. Clone and configure

```bash
git clone https://github.com/MuddyWinds/atc-monitor.git
cd atc-monitor
cp .env.example .env
```

Edit `.env` and set:

```env
GEMINI_API_KEY=your_key_here
```

### 2. Run with Docker

```bash
docker compose up
```

Open `http://localhost:3000` — the dashboard loads automatically.

### 3. Start monitoring a feed

In the **Airport Sidebar**, select an airport (KJFK, KATL, KLAX, KORD, VHHH) or paste a custom LiveATC URL and click **Start**.

Or via API:

```bash
# Start KSFO tower feed
curl -X POST "http://localhost:8000/api/monitor/start?feed_url=http://feeds.liveatc.net/ksfo&airport_code=KSFO"

# Stop monitoring
curl -X POST "http://localhost:8000/api/monitor/stop?airport_code=KSFO"
```

---

## Running Locally (Development)

```bash
# Terminal 1 — Database
docker compose up db

# Terminal 2 — Backend
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Terminal 3 — Frontend
cd frontend
npm install && npm start
```

## Running Tests

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m pytest
```

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/monitor/start` | Start monitoring a feed |
| `POST` | `/api/monitor/stop` | Stop monitoring |
| `GET` | `/api/monitor/status` | Active monitors |
| `GET` | `/api/results` | Paginated analysis history |
| `GET` | `/api/stats` | Aggregate phraseology statistics |
| `GET` | `/api/adsb/{airport_code}` | Live ADS-B traffic (60s cache) |
| `GET` | `/api/adsb-snapshot/{result_id}` | ADS-B state captured at analysis time |
| `GET` | `/api/metar/{airport_code}` | Current METAR weather |
| `GET` | `/api/notam/{airport_code}` | Active NOTAMs (5-min cache) |
| `GET` | `/api/hazards/{airport_code}` | SIGMET / AIRMET / PIREP (5-min cache) |
| `GET` | `/api/study-sheet/{id}` | Per-aircraft Gemini study sheet |
| `WS` | `/ws/live` | Real-time results stream |

---

## Finding Feeds

Browse available feeds at [liveatc.net/feedindex.php](https://www.liveatc.net/feedindex.php).

Supported airports with full ADS-B correlation out of the box:

| ICAO | Airport |
|---|---|
| KJFK | New York JFK |
| KATL | Atlanta Hartsfield–Jackson |
| KLAX | Los Angeles International |
| KORD | Chicago O'Hare |
| VHHH | Hong Kong International |

---

## Limitations & Caveats

- **One-sided transcripts** — LiveATC captures one radio side only. The analyser is explicitly told not to flag missing readbacks that may simply be on the other side.
- **Transcription noise** — Whisper on VHF radio audio is imperfect. Low-confidence segments are filtered out rather than sent for analysis.
- **Not a safety-critical system** — This is a hobbyist/research tool. Do not use it for operational decisions.
- **Gemini quota** — The free tier has a daily token limit. The 4-minute batch window and 15-transcript cap are designed to stay within it.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Audio ingestion | ffmpeg |
| Speech-to-text | faster-whisper (Whisper large-v2, int8) |
| Phraseology AI | Google Gemini Flash |
| Backend | Python / FastAPI / SQLAlchemy (async) |
| Database | PostgreSQL 16 |
| ADS-B data | OpenSky Network (free, anonymous) |
| Weather / NOTAM | aviationweather.gov / aviationapi.com |
| Frontend | React / TypeScript |
| Containerisation | Docker Compose |

---

## Contributing

PRs welcome. If you add a new airport, add its coordinates to `AIRPORT_GEO` in `backend/core/batcher.py` so ADS-B correlation works.
