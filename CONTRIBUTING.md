# Contributing to Readback

Thanks for your interest in contributing. This is a hobbyist aviation education project — all skill levels are welcome, whether you're a pilot, an ATC enthusiast, or just a developer who finds the problem interesting.

## Ways to Contribute

- **Bug reports** — something crashed, gave a wrong result, or behaved unexpectedly
- **New airports** — add ADS-B coordinates for more airports
- **Phraseology improvements** — refine the Gemini prompt for better FAA/ICAO accuracy
- **Frontend polish** — UI improvements to the dashboard
- **Documentation** — clearer setup instructions, diagrams, examples

---

## Reporting a Bug

1. Check [existing issues](https://github.com/MuddyWinds/atc-monitor/issues) first
2. Open a new issue and include:
   - What you expected to happen
   - What actually happened
   - Steps to reproduce (airport code + feed URL if relevant)
   - Any error output from the backend logs (`docker compose logs backend`)
   - Your OS and Python version

For **false positives** (the AI flagged something that wasn't actually a phraseology observation) or **false negatives** (a clear situational event was missed), please include:
- The raw transcript text
- The airport and approximate time
- What the correct assessment should be and why

---

## Adding a New Airport

The quickest contribution. In `backend/core/batcher.py`, add an entry to `AIRPORT_GEO`:

```python
AIRPORT_GEO: dict[str, tuple[float, float]] = {
    "KJFK": (40.64, -73.78),
    "KATL": (33.64, -84.43),
    # Add yours here:
    "EGLL": (51.48, -0.46),   # London Heathrow
}
```

Coordinates are `(latitude, longitude)` at the airport centrepoint. The batcher queries a ±1.5° lat / ±3.0° lon bounding box around this point for ADS-B traffic.

Open a PR with the airport code, full name, and source for the coordinates (e.g. AIP, Wikipedia, OurAirports).

---

## Development Setup

```bash
git clone https://github.com/MuddyWinds/atc-monitor.git
cd atc-monitor
cp .env.example .env
# Add your GEMINI_API_KEY to .env

# Start the database
docker compose up db

# Backend (in a separate terminal)
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload --port 8000

# Frontend (in a separate terminal)
cd frontend
npm install && npm start
```

---

## Making a Pull Request

1. Fork the repo and create a branch: `git checkout -b my-feature`
2. Make your changes
3. Test manually — start a feed, let it run through at least one batch cycle (4 minutes), confirm results appear in the dashboard
4. Open a PR with a clear description of what you changed and why

### PR Guidelines

- Keep PRs focused — one change per PR is easier to review
- If you're changing the Gemini prompt in `phraseology.py`, include before/after examples of how the output changed
- Don't commit `.env`, `venv/`, `*.db`, or `node_modules/` — they're in `.gitignore` for a reason
- Don't add new dependencies without discussing in an issue first

---

## Prompt / AI Behaviour Changes

The phraseology analysis prompt in `backend/analysis/phraseology.py` is the most sensitive part of the project. Changes here can have wide effects on false positive/negative rates.

If you want to improve it:
- Open an issue first describing the problem you're seeing (e.g. "it keeps flagging single-sided readbacks as observations")
- Include example transcripts that trigger the wrong behaviour
- Propose the specific prompt change

---

## Questions?

Open an issue tagged `question`. There's no mailing list or chat yet.
