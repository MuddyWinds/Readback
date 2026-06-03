# Readback

> *ATC phraseology, read back to you.*


https://github.com/user-attachments/assets/492c1183-24e6-4f17-9e14-7e773a6118fa


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
- Batches transcripts and sends them to **Gemini Flash** for phraseology analysis every 5 minutes (configurable in Settings)
- Applies the *Reasonable Controller Test* — notes genuine deviations, ignores transcription noise and one-sided readback gaps
- Classifies observations using **HFACS taxonomy** (Human Factors Analysis and Classification System)
- Correlates findings with live **ADS-B traffic** from OpenSky Network
- Pulls **METAR weather**, **NOTAMs**, and **SIGMET/AIRMET/PIREP** hazards for full situational context
- Streams results live to a React dashboard via WebSocket

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
   run_batcher()          drains queue every 5 minutes (configurable)
        │                 caps at batch_max_items per batch (default 40)
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
   ├── HeaderBar           feed controls + live audio
   ├── LiveFeed            real-time transcript + observation stream
   │   └── ObservationCard per-transmission detail + HFACS category
   ├── AirportSidebar      map, ADS-B, weather + NOTAMs for the selected airport
   └── SettingsPage        configure feeds, batch interval, STT model, alerts
```

### Key Design Decisions

| Decision | Reason |
|---|---|
| Batch Gemini calls (5-min window) | Conserves free-tier daily quota; one call covers all airports |
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

You need just two things to begin:

- A free [**Gemini API key**](https://aistudio.google.com/app/apikey) (the free tier is plenty).
- A runtime: **Docker** (simplest), or **Node + Python** from source — pick a path below.

First, clone the repo and add your key:

```bash
git clone https://github.com/MuddyWinds/Readback.git
cd Readback
cp .env.example .env          # then open .env and paste your Gemini key
```

```env
# .env — the only required setting
GEMINI_API_KEY=your_key_here
```

Now choose **one** of the two paths.

### Option A — Docker (recommended)

The simplest way to run everything. Docker starts the database, backend, and frontend
together — one command, nothing else to install.

> Make sure **Docker Desktop is running** first.

```bash
docker compose up
```

Open **http://localhost:3000** and jump to [First run](#first-run-configure-a-feed).

### Option B — Run from source (database in Docker)

Best if you'd rather run the backend and frontend from source while developing. The
**backend and frontend run natively**; only the **database** stays in Docker — a single
lightweight Postgres container so your data persists in one place and matches Option A
exactly. (Don't mix this with SQLite — see the note below — or your records will split
across two separate databases. Want *zero* Docker? See [Option C](#option-c--fully-docker-free-native-postgres).)

Install **Node 18+**, **Python 3.11+**, and **ffmpeg** (`brew install ffmpeg` on Mac,
`apt install ffmpeg` on Linux). Then, from the repo root:

```bash
# Terminal 1 — backend (reads DATABASE_URL from .env → Postgres on localhost:5432)
docker compose up -d db
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn backend.main:app --port 8000 --reload
```

```bash
# Terminal 2 — frontend
cd frontend
npm install
npm run dev
```

Open **http://localhost:3000**.

> **Don't pass a `DATABASE_URL=` override here.** Without it the backend uses the value in
> `.env` (`postgresql://atc:atc@localhost:5432/atcmonitor`, auto-upgraded to the async
> driver), so it always reads and writes the same Postgres data. Prepending a
> `DATABASE_URL="sqlite+aiosqlite:///./readback.db"` would point it at a *separate, empty*
> SQLite file and your existing threads would appear to vanish.

> **Really want a server-less SQLite file instead?** Install the extra driver and pass the
> override explicitly — but commit to it, because SQLite and Postgres never share data:
> `.venv/bin/pip install aiosqlite` then run with
> `DATABASE_URL="sqlite+aiosqlite:///./readback.db" .venv/bin/python -m uvicorn backend.main:app --port 8000 --reload`.

### Option C — Fully Docker-free (native Postgres)

For zero Docker at all, run Postgres natively. The trade-off: a native install is a
**separate, empty database** from the Docker volume, so if you already have data in Docker
(Option A/B) you must migrate it once — otherwise you start fresh.

Install **Node 18+**, **Python 3.11+**, **ffmpeg**, and **Postgres 16**
(`brew install postgresql@16 ffmpeg` on Mac). Then create the database and role to match
the project's default `DATABASE_URL`:

```bash
# One-time: create the atc role + atcmonitor database
brew services start postgresql@16
createuser -s atc 2>/dev/null; psql -d postgres -c "ALTER USER atc WITH PASSWORD 'atc';"
createdb -O atc atcmonitor
```

```bash
# Terminal 1 — backend (no Docker; uses .env → postgresql://atc:atc@localhost:5432/atcmonitor)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn backend.main:app --port 8000 --reload
```

Run the frontend exactly as in Option B (Terminal 2). The schema is created automatically
on first backend start.

> **Already have data in the Docker volume?** Migrate it once with the helper scripts
> ([details below](#moving-data-between-databases)):
> ```bash
> docker compose up -d db              # start the Docker DB
> scripts/db_export.sh                 # → backups/readback_<timestamp>.sql
> docker compose down                  # free port 5432
> brew services start postgresql@16
> scripts/db_import.sh backups/readback_*.sql   # load into native Postgres
> ```
> Only **one** Postgres can bind port 5432 at a time, so stop the Docker DB before starting
> the native one (and vice versa).

### Moving data between databases

Your records live in whichever Postgres `DATABASE_URL` points at — there is no automatic
sync between a Docker and a native install. To move them, use the two helper scripts (both
read `DATABASE_URL`, strip any `+driver` suffix, and fall back to the `readback-db-1`
container when no local `pg_dump`/`psql` is installed):

```bash
# Export the current database to a timestamped dump in backups/
scripts/db_export.sh [output_file]

# Restore a dump into the database DATABASE_URL points at.
# Refuses to run if the target already has rows (pass --force to merge anyway).
scripts/db_import.sh <dump_file> [--force]
```

`db_export.sh` doubles as a backup tool; `db_import.sh` is the safe way to seed a fresh
database (e.g. when switching to [Option C](#option-c--fully-docker-free-native-postgres)).
Always restore into an **empty** database — `pg_dump` preserves the ID sequence, so new
rows continue past your existing IDs without collisions.

### First run: configure a feed

On first launch the app opens the **Settings** tab automatically (it detects that no
feeds are configured yet). Add one or more LiveATC feeds — each with an airport code —
and save. Then switch to the **Live** tab and click **▶ Start All** to begin monitoring.

You can paste either a LiveATC **stream URL** (`audio.liveatc.net/<mount>`) or the
**listen-page link** from your browser (e.g.
`https://www.liveatc.net/hlisten.php?mount=vhhh5&icao=vhhh`) — click **Verify** and it is
converted to a working stream URL with the airport code filled in. Coordinates, runways,
the map marker, ADS-B correlation, hazards, and weather then resolve automatically for
**any operational fixed-wing ICAO airport worldwide** — the airports listed below are just
convenient starting points.

Prefer the command line? You can drive monitoring through the API instead:

```bash
# Start a feed
curl -X POST "http://localhost:8000/api/monitor/start?feed_url=http://feeds.liveatc.net/ksfo&airport_code=KSFO"

# Stop it
curl -X POST "http://localhost:8000/api/monitor/stop?airport_code=KSFO"
```

### View it on your phone (same Wi-Fi)

Yes — you can keep your **laptop as the server** and open the dashboard on your **phone**,
as long as both are on the **same Wi-Fi network**. The dashboard is just a web page that
your laptop serves; the phone is only a viewer.

Two small settings let the phone's browser reach your laptop (instead of looking for the
backend on the phone itself):

1. **Find your laptop's local IP address** — say it's `192.168.1.42`:

   ```bash
   ipconfig getifaddr en0          # macOS (Wi-Fi)
   hostname -I | awk '{print $1}'  # Linux
   ```

2. **Point the frontend at that IP, and allow it through CORS.** In `.env`:

   ```env
   ALLOWED_ORIGINS=http://localhost:3000,http://192.168.1.42:3000
   ```

   In `frontend/.env.development`:

   ```env
   VITE_API_BASE=http://192.168.1.42:8000
   VITE_WS_URL=ws://192.168.1.42:8000/ws/live
   ```

3. **Restart** so the changes take effect — for Docker run `docker compose up -d --build`
   (the frontend image bakes its env in at build time); for Option B, just restart the two
   dev servers.

4. On your phone, open **http://192.168.1.42:3000**.

> Swap `192.168.1.42` for your real IP everywhere above. On macOS, approve the firewall
> prompt to *allow incoming connections* the first time. This setup keeps working on the
> laptop at `http://localhost:3000` too, so you don't have to choose.

---

## Everyday Use

Once the project is set up, these are the routine commands. **Always make sure Docker
Desktop is running first.**

```bash
# Start the whole stack (db + backend + frontend) in the background
docker compose up -d

# Open the dashboard
open http://localhost:3000

# See what's running and tail logs
docker compose ps
docker compose logs -f            # all services
docker compose logs -f backend    # one service

# Stop the stack (the Postgres volume is preserved)
docker compose down

# Restart one service (e.g. after editing backend code)
docker compose restart backend

# Rebuild after changing dependencies (requirements.txt / package.json)
docker compose up -d --build
```

The stack publishes host ports **`3000`** (frontend), **`8000`** (backend) and
**`5432`** (Postgres).

> **Port conflicts.** If another process already holds one of those ports — e.g. a
> stray frontend dev server from another project on `:3000` — Docker may bind only one IP
> family and `http://localhost:3000` becomes ambiguous (you can end up looking at the
> wrong app). Free the port, then let the container rebind:
>
> ```bash
> lsof -nP -iTCP:3000 -sTCP:LISTEN   # find what's holding it
> kill <PID>                          # stop the stray process
> docker compose restart frontend     # rebind the container
> ```

> **Troubleshooting.** If the dashboard shows **"Unable to load analysis cards"** or
> **"Loading settings…"** that never finishes, the frontend can't reach the backend on
> `:8000`. Confirm `docker compose ps` lists `readback-backend-1` as `Up` and that
> nothing else is squatting on port `8000`.

---

## Configuration

All backend settings are read from `.env` (template in `.env.example`). The ones you're
most likely to touch:

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | — *(required)* | Your Gemini API key |
| `DATABASE_URL` | `postgresql://atc:atc@localhost:5432/atcmonitor` | Database connection. Use `sqlite+aiosqlite:///./readback.db` for a zero-install local file; Docker sets the Postgres URL for you |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated browser origins allowed to call the API. Add your laptop's LAN origin to view on a phone, or your deployed domain |
| `WHISPER_MODEL` | `base` | faster-whisper model: `tiny` / `base` / `small` / `medium` / `large` |

The **frontend** resolves the backend from the page's own origin by default, so a
same-origin production build behind a reverse proxy needs no configuration. For the split
`:3000` / `:8000` dev setup it reads `frontend/.env.development` (`VITE_API_BASE`,
`VITE_WS_URL`). Point those at another host (e.g. your LAN IP) to reach the backend from a
different device — and add that origin to `ALLOWED_ORIGINS` so CORS lets it through.

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
| `GET` | `/api/pipeline/status` | Pipeline / worker health |
| `GET` | `/api/airports` | Configured / supported airports |
| `GET` | `/api/results` | Paginated analysis history |
| `PATCH` | `/api/results/{result_id}` | Update a single result (e.g. dismiss/annotate) |
| `GET` | `/api/stats` | Aggregate phraseology statistics |
| `GET` | `/api/adsb/{airport_code}` | Live ADS-B traffic (60s cache) |
| `GET` | `/api/adsb-snapshot/{result_id}` | ADS-B state captured at analysis time |
| `GET` | `/api/metar/{airport_code}` | Current METAR weather |
| `GET` | `/api/notam/{airport_code}` | Active NOTAMs (5-min cache) |
| `GET` | `/api/hazards/{airport_code}` | SIGMET / AIRMET / PIREP (5-min cache) |
| `GET` | `/api/study-sheet/{result_id}` | Per-aircraft Gemini study sheet |
| `GET` | `/api/settings` | Read current settings (feeds, batch interval, …) |
| `PUT` | `/api/settings` | Update settings |
| `POST` | `/api/settings/verify-feed` | Validate a LiveATC feed URL before saving |
| `WS` | `/ws/live` | Real-time results stream |

---

## Finding Feeds

Browse available feeds at [liveatc.net/feedindex.php](https://www.liveatc.net/feedindex.php).

Example feeds to get you started - any operational fixed-wing ICAO airport resolves the
same way (map marker, ADS-B, hazards, runway overlay):

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
- **Gemini quota** — The free tier has a daily token limit. The 5-minute batch window and the per-batch transcript cap (`batch_max_items`, default 40) are designed to stay within it; lower either in Settings if you hit limits.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Audio ingestion | ffmpeg |
| Speech-to-text | faster-whisper (configurable model, default `base`, int8) |
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

---

## License

Released under the [MIT License](LICENSE).
