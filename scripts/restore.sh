#!/usr/bin/env bash
# Restores a dump made by scripts/backup.sh into a database. The target database is
# NOT dropped or created for you -- create an empty one first, so you never accidentally
# restore on top of a live database by mistake. Example (fresh restore target):
#   createdb -h <host> -U postgres tgbingo_restored
#   DATABASE_URL=postgresql://postgres:postgres@<host>:5432/tgbingo_restored \
#     ./scripts/restore.sh backups/tgbingo-20260909T120000Z.dump
#
# Usage:
#   DATABASE_URL=postgresql://user:pass@host:5432/dbname ./scripts/restore.sh <dump-file>
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the (empty) database to restore into}"
DUMP_FILE="${1:?Usage: DATABASE_URL=... ./scripts/restore.sh <dump-file>}"

if [ ! -f "$DUMP_FILE" ]; then
  echo "No such file: $DUMP_FILE" >&2
  exit 1
fi

echo "Restoring $DUMP_FILE -> $DATABASE_URL"
# --clean --if-exists so this is also safe to re-run against a database that already has
# a previous (older) restore in it; --no-owner/--no-privileges because the restoring role
# may not match whoever originally owned the objects (e.g. a managed Postgres provider).
pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --no-privileges "$DUMP_FILE"

echo "Restore complete. Sanity-check row counts:"
psql "$DATABASE_URL" -c "
  SELECT 'wallets' AS table, count(*) FROM wallets
  UNION ALL SELECT 'transactions', count(*) FROM transactions
  UNION ALL SELECT 'rounds', count(*) FROM rounds
  UNION ALL SELECT 'house_ledger', count(*) FROM house_ledger
  UNION ALL SELECT 'bot_users', count(*) FROM bot_users;
"
