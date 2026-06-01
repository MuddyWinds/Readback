from __future__ import annotations

"""Read-only attribution diagnostic.

Classifies PILOT turns that carry NO callsign (bare read-backs) into three
buckets so the fix is driven by where attribution *actually* fails:

  within_chunk_recoverable
      The SAME transcript already names a callsign (an ATC turn has one). The
      existing adjacent-turn rule (phraseology.py) should have threaded this —
      a hit here means debug THAT rule, not the cross-transcript clause (Task 3
      does nothing for these).

  within_batch_sibling
      No callsign in this transcript, but a *sibling* transcript that would have
      shared this row's Gemini batch (same airport, within one batch-interval
      window) names a callsign. THIS is the bucket the Task 3 cross-transcript
      clause targets.

  cross_batch
      No callsign in this transcript and none in any same-batch sibling — the
      instruction is in a *different* batch. Needs Approach A2 (cross-batch
      rolling context), which is out of scope here.

Batch membership is not persisted, so "same batch" is APPROXIMATED by (airport,
±window) where `window` is the configured batch interval. This over-counts
within_batch_sibling — a generous upper bound on what Task 3 could fix, the safe
direction for a gate.

The window defaults to the *current* runtime interval (`_batch_interval()`), not
the hardcoded 300s constant, because the runtime can override it. That is still
only an estimate: it reflects config *now*, which may differ from the interval
when historical rows were captured — so the window is also exposed as a CLI arg
for an operator who knows the real interval for the data being scanned.

Run (Postgres must be up):  python -m scripts.diagnose_attribution [--window-seconds N]
"""

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import select

from backend.core.batcher import _batch_interval
from backend.db.database import AsyncSessionLocal
from backend.db.models import AnalysisResultDB


def _ts(row) -> datetime:
    """AnalysisResultDB.timestamp as a datetime (tolerate str rows)."""
    t = row.timestamp
    return t if isinstance(t, datetime) else datetime.fromisoformat(str(t).replace("Z", ""))


def _names_callsign(row) -> bool:
    segs = (row.enrichment or {}).get("speaker_segments") or []
    return any(s.get("callsign") for s in segs)


async def main(limit: int = 500, window_seconds: int | None = None) -> None:
    counts: Counter[str] = Counter()
    sibling_samples: list[str] = []
    rule_miss_samples: list[str] = []
    window_s = window_seconds if window_seconds is not None else _batch_interval()
    window = timedelta(seconds=window_s)

    async with AsyncSessionLocal() as session:
        rows = (await session.execute(
            select(AnalysisResultDB).order_by(AnalysisResultDB.id.desc()).limit(limit)
        )).scalars().all()

    for row in rows:
        enr = row.enrichment or {}
        segments = enr.get("speaker_segments") or []
        if not segments:
            continue
        bare = [s for s in segments if s.get("role") == "PILOT" and not s.get("callsign")]
        if not bare:
            continue
        counts["bare_pilot_turns"] += len(bare)

        if any(s.get("callsign") for s in segments):
            counts["within_chunk_recoverable"] += len(bare)
            if len(rule_miss_samples) < 10:
                rule_miss_samples.append(f"[{row.id} {row.airport_code}] {row.transcript[:120]}")
            continue

        # No callsign in this chunk — does a plausibly same-batch sibling name one?
        sibling_has_callsign = any(
            other.id != row.id
            and other.airport_code == row.airport_code
            and abs((_ts(other) - _ts(row)).total_seconds()) <= window.total_seconds()
            and _names_callsign(other)
            for other in rows
        )
        if sibling_has_callsign:
            counts["within_batch_sibling"] += len(bare)
            if len(sibling_samples) < 15:
                sibling_samples.append(f"[{row.id} {row.airport_code}] {row.transcript[:120]}")
        else:
            counts["cross_batch"] += len(bare)

    print("=== Attribution diagnostic ===")
    print(f"scanned results: {len(rows)}  (batch window ≈ {window_s}s)")
    for k, v in counts.most_common():
        print(f"{k}: {v}")
    print("\n--- within_chunk_recoverable: existing within-transcript rule missed these ---")
    for line in rule_miss_samples:
        print(line)
    print("\n--- within_batch_sibling: Task 3's cross-transcript clause targets these ---")
    for line in sibling_samples:
        print(line)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=500)
    ap.add_argument("--window-seconds", type=int, default=None,
                    help="Same-batch time window; defaults to the runtime batch interval.")
    args = ap.parse_args()
    asyncio.run(main(limit=args.limit, window_seconds=args.window_seconds))
