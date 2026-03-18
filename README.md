# ATC Compliance Monitor — Phase 1 MVP

Real-time ATC audio monitoring with FAA/ICAO compliance analysis powered by Claude.

## Quick Start

### 1. Prerequisites
- Docker + Docker Compose
- ffmpeg (`brew install ffmpeg` on Mac)
- Anthropic API key

### 2. Setup
```bash
cd atc-monitor
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

### 3. Run with Docker
```bash
docker compose up
```

### 4. Run locally (dev)
```bash
# Terminal 1 — Database
docker compose up db

# Terminal 2 — Backend
cd atc-monitor
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Terminal 3 — Frontend
cd atc-monitor/frontend
npm install && npm start
```

### 5. Start monitoring
Open http://localhost:3000, select a feed, click **Start**.

Or via API:
```bash
curl -X POST "http://localhost:8000/api/monitor/start?feed_url=http://feeds.liveatc.net/ksfo&airport_code=KSFO"
```

## Architecture

```
LiveATC Stream → ffmpeg → Whisper STT → Claude Analysis → PostgreSQL
                                                        ↓
                                              WebSocket → React Dashboard
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/monitor/start` | Start monitoring a feed |
| POST | `/api/monitor/stop` | Stop monitoring |
| GET | `/api/monitor/status` | Check if running |
| GET | `/api/results` | Paginated analysis history |
| GET | `/api/stats` | Aggregate statistics |
| WS | `/ws/live` | Real-time results stream |

## Violation Categories (HFACS)
- Runway Incursion / Excursion
- Altitude / Speed Deviation
- Read-back Error
- Communication Failure
- CFIT Risk
- TCAS Non-compliance
- Navigation Error
- Fuel Mismanagement

## Find LiveATC Feeds
Browse feeds at: https://www.liveatc.net/feedindex.php
