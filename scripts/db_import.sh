#!/usr/bin/env bash
#
# Restore a Readback Postgres dump (from scripts/db_export.sh) into the
# target database named by $DATABASE_URL.
#
# Usage:
#   scripts/db_import.sh <dump_file> [--force]
#
# SAFETY: refuses to run if the target already holds analysis_results rows,
# to avoid primary-key collisions and duplicated data. Restore into an EMPTY
# database (the intended migration path). Pass --force only if you understand
# the rows will be merged on top of whatever is already there.
#
# Like db_export.sh, the connection comes from $DATABASE_URL (any "+driver"
# suffix is stripped) and falls back to the running `readback-db-1` container
# when no local `psql` is installed.
set -euo pipefail

DUMP="${1:-}"
FORCE="${2:-}"
if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "usage: scripts/db_import.sh <dump_file> [--force]" >&2
  exit 1
fi

PG_URI="${DATABASE_URL:-postgresql://atc:atc@localhost:5432/atcmonitor}"
PG_URI="${PG_URI/+asyncpg/}"
PG_URI="${PG_URI/+psycopg2/}"
PG_URI="${PG_URI/+psycopg/}"

if [[ "$PG_URI" == sqlite* ]]; then
  echo "error: DATABASE_URL points at SQLite ($PG_URI)." >&2
  echo "       These scripts are Postgres-only; SQLite is a single file you can just copy." >&2
  exit 1
fi

PG_USER="$(sed -E 's#.*://([^:/]+).*#\1#' <<<"$PG_URI")"
PG_DB="$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$PG_URI")"

if command -v psql >/dev/null 2>&1; then
  MODE=local
elif docker ps --format '{{.Names}}' | grep -qx readback-db-1; then
  MODE=docker
else
  echo "error: need a local 'psql' OR a running 'readback-db-1' container." >&2
  echo "       Start the DB with: docker compose up -d db" >&2
  exit 1
fi

# scalar query helper
q() {
  case "$MODE" in
    local)  psql "$PG_URI" -tAc "$1" 2>/dev/null ;;
    docker) docker exec -i readback-db-1 psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null ;;
  esac
}

# stream the dump file into psql
load() {
  case "$MODE" in
    local)  psql "$PG_URI" -v ON_ERROR_STOP=1 <"$DUMP" ;;
    docker) docker exec -i readback-db-1 psql -U "$PG_USER" -d "$PG_DB" -v ON_ERROR_STOP=1 <"$DUMP" ;;
  esac
}

existing="$(q "SELECT count(*) FROM analysis_results" || true)"
existing="${existing//[^0-9]/}"
existing="${existing:-0}"

if [[ "$existing" -gt 0 && "$FORCE" != "--force" ]]; then
  echo "refusing: target already has $existing analysis_results row(s)." >&2
  echo "          Restore into an empty database, or pass --force to merge anyway." >&2
  exit 1
fi

echo "Restoring $DUMP into $PG_DB (mode=$MODE)..."
load
echo "Done — analysis_results now: $(q 'SELECT count(*) FROM analysis_results')"
