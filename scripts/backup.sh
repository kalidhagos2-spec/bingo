#!/usr/bin/env bash
# Backs up the shared Postgres database (server + bot tables live in one database -- see
# docker-compose.yml's DATABASE_URL) to a single timestamped, compressed dump file.
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/dbname ./scripts/backup.sh [output-dir]
#
# output-dir defaults to ./backups. Requires `pg_dump` (matching your Postgres major
# version, ideally) on PATH -- the official postgres:16-alpine image has it; locally,
# install the postgresql-client package.
#
# This uses pg_dump's custom format (-Fc): compressed, and restorable with pg_restore
# either as a full restore or selectively (single table, schema-only, data-only, etc.),
# which a plain SQL dump can't do as cleanly. See scripts/restore.sh for the other half.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to back up (see server/.env.example)}"

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$OUT_DIR/tgbingo-$TIMESTAMP.dump"

echo "Backing up $DATABASE_URL -> $OUT_FILE"
pg_dump --dbname="$DATABASE_URL" --format=custom --file="$OUT_FILE"

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "Done: $OUT_FILE ($SIZE)"
echo
echo "Verify the dump is readable (does not touch any database):"
echo "  pg_restore --list \"$OUT_FILE\" | head"
