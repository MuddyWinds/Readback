"""
One-shot migration: ATC Compliance Monitor -> Readback reframe.

Renames columns on analysis_results and rewrites the observations JSON
so each finding carries `kind`, `note_type`, and `significance`.

Usage:  python3 scripts/0001_readback_reframe.py [path/to/atcmonitor.db]
Idempotent: exits early if already migrated.
"""

import json
import shutil
import sqlite3
import sys

# spec §4 mapping — kept inline so the migration has no app-code dependency.
KIND_BY_NOTE_TYPE = {
    "Read-back Error": "phraseology_note",
    "Frequency/Channel Error": "phraseology_note",
    "Communication Failure": "phraseology_note",
    "Navigation Error": "phraseology_note",
    "Other": "phraseology_note",
    "Runway Incursion": "situational_event",
    "Runway Excursion": "situational_event",
    "Altitude Deviation": "situational_event",
    "Speed Deviation": "situational_event",
    "CFIT Risk": "situational_event",
    "TCAS Non-compliance": "situational_event",
    "Go-around Non-compliance": "situational_event",
    "Fuel Mismanagement": "situational_event",
}


def _columns(conn, table):
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def migrate(db_path: str) -> None:
    if sqlite3.sqlite_version_info < (3, 25, 0):
        raise RuntimeError(f"SQLite >= 3.25 required for RENAME COLUMN; have {sqlite3.sqlite_version}")

    conn = sqlite3.connect(db_path)
    try:
        cols = _columns(conn, "analysis_results")
        if "observations" in cols:
            print(f"[migrate] {db_path} already migrated — nothing to do.")
            return

        backup = db_path + ".pre-readback.bak"
        shutil.copy2(db_path, backup)
        print(f"[migrate] backed up -> {backup}")

        if "is_compliant" in cols:
            conn.execute("ALTER TABLE analysis_results RENAME COLUMN is_compliant TO is_standard")
        conn.execute("ALTER TABLE analysis_results RENAME COLUMN violations TO observations")
        if "officer_notes" in cols:
            conn.execute("ALTER TABLE analysis_results RENAME COLUMN officer_notes TO reviewer_notes")

        rows = conn.execute("SELECT id, observations FROM analysis_results").fetchall()
        rewritten = 0
        findings = 0
        for row_id, raw in rows:
            if not raw:
                continue
            data = json.loads(raw)
            if not isinstance(data, list):
                continue
            for f in data:
                if "violation_type" in f:
                    f["note_type"] = f.pop("violation_type")
                if "severity" in f:
                    f["significance"] = f.pop("severity")
                f["kind"] = KIND_BY_NOTE_TYPE.get(f.get("note_type"), "phraseology_note")
                findings += 1
            conn.execute(
                "UPDATE analysis_results SET observations = ? WHERE id = ?",
                (json.dumps(data), row_id),
            )
            rewritten += 1

        conn.execute("UPDATE analysis_results SET status='confirmed' WHERE status='escalated'")
        conn.commit()
        print(f"[migrate] done: {len(rows)} rows scanned, "
              f"{rewritten} rewritten, {findings} findings updated.")
    finally:
        conn.close()


if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else "atcmonitor.db"
    migrate(path)
