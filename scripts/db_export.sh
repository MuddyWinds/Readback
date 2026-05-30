#!/usr/bin/env bash
#
# Export the Readback Postgres database to a timestamped .sql dump.
#
# Usage:
#   scripts/db_export.sh [output_file]
#
# The connection comes from $DATABASE_URL (any "+driver" suffix such as
# +asyncpg is stripped automatically), defaulting to the project's local
# Postgres URL. Works whether Postgres runs natively or in the Docker
# container: if no local `pg_dump` is installed it falls back to running
# pg_dump inside the `readback-db-1` container.
#
# Pairs with scripts/db_import.sh to move data between machines/backends.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PG_URI="${DATABASE_URL:-postgresql://atc:atc@localhost:5432/atcmonitor}"
PG_URI="${PG_URI/+asyncpg/}"
PG_URI="${PG_URI/+psycopg2/}"
PG_URI="${PG_URI/+psycopg/}"

if [[ "$PG_URI" == sqlite* ]]; then
  echo "error: DATABASE_URL points at SQLite ($PG_URI)." >&2
  echo "       These scripts are Postgres-only; SQLite is a single file you can just copy." >&2
  exit 1
fi

OUT="${1:-$REPO_ROOT/backups/readback_$(date +%Y%m%d_%H%M%S).sql}"
mkdir -p "$(dirname "$OUT")"

# user/db parsed from the URI for the docker-exec fallback
PG_USER="$(sed -E 's#.*://([^:/]+).*#\1#' <<<"$PG_URI")"
PG_DB="$(sed -E 's#.*/([^/?]+)(\?.*)?$#\1#' <<<"$PG_URI")"

if command -v pg_dump >/dev/null 2>&1; then
  echo "Exporting via local pg_dump → $OUT"
  pg_dump "$PG_URI" >"$OUT"
elif docker ps --format '{{.Names}}' | grep -qx readback-db-1; then
  echo "No local pg_dump; exporting via docker exec readback-db-1 (user=$PG_USER db=$PG_DB) → $OUT"
  docker exec -i readback-db-1 pg_dump -U "$PG_USER" -d "$PG_DB" >"$OUT"
else
  echo "error: need a local 'pg_dump' OR a running 'readback-db-1' container." >&2
  echo "       Start the DB with: docker compose up -d db" >&2
  exit 1
fi

bytes="$(wc -c <"$OUT" | tr -d ' ')"
echo "Done — $bytes bytes written."
echo "Restore elsewhere with: scripts/db_import.sh \"$OUT\""
