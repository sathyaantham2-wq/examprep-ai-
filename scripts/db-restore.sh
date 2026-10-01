#!/usr/bin/env bash
# F014: restore an encrypted backup made by db-backup.sh, then check every table's row count.
#
#   TARGET_DATABASE_URL=postgres://...  BACKUP_PASSPHRASE=...  scripts/db-restore.sh <file.dump.enc> [file.counts]
#
# The target must be an EMPTY database (a fresh Supabase project, or a scratch local one). It
# refuses the production host unless ALLOW_PRODUCTION_RESTORE=yes is set, because a restore
# over the live database is the one mistake this runbook exists to prevent. See
# docs/runbooks/backup-restore.md before using that.
set -euo pipefail

dump="${1:?usage: db-restore.sh <file.dump.enc> [file.counts]}"
counts="${2:-${dump%.dump.enc}.counts}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"

case "$TARGET_DATABASE_URL" in
  *lqtaqzthtohdnjibxjki*)
    if [ "${ALLOW_PRODUCTION_RESTORE:-}" != "yes" ]; then
      echo "Refusing to restore into the production database. See docs/runbooks/backup-restore.md." >&2
      exit 1
    fi
    ;;
esac

existing="$(psql "$TARGET_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c \
  "select count(*) from information_schema.tables where table_schema = 'public'")"
if [ "$existing" != "0" ]; then
  echo "Target database is not empty ($existing tables in public). Restore into an empty database." >&2
  exit 1
fi

# The dump recreates the public schema itself (CREATE SCHEMA public), and every new database
# already has an empty one. It was just checked to hold no tables, so it is safe to drop.
psql "$TARGET_DATABASE_URL" -X -q -v ON_ERROR_STOP=1 -c "drop schema public cascade"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$dump" |
  pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --no-privileges --exit-on-error

if [ ! -f "$counts" ]; then
  echo "restore done; no .counts file next to the dump, so row counts were not verified"
  exit 0
fi

# The counts were taken moments before the dump of a live database, so a busy table (sessions,
# answers being typed) can legitimately differ by a few rows. A missing table, or one that came
# back empty when it had rows, always fails; any other difference is reported, and fails only
# beyond 10 rows or 2%.
mismatch=0
while IFS=$'\t' read -r table expected; do
  [ -n "$table" ] || continue
  actual="$(psql "$TARGET_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from public.\"$table\"" 2>/dev/null | tr -d '\r')"
  [ -n "$actual" ] || actual=missing
  [ "$actual" = "$expected" ] && continue
  if [ "$actual" = "missing" ] || { [ "$actual" = "0" ] && [ "$expected" != "0" ]; }; then
    echo "MISSING $table: backup counted $expected, restored $actual"
    mismatch=$((mismatch + 1))
    continue
  fi
  diff=$((actual > expected ? actual - expected : expected - actual))
  allowed=$((expected / 50 > 10 ? expected / 50 : 10))
  if [ "$diff" -gt "$allowed" ]; then
    echo "MISMATCH $table: backup counted $expected, restored $actual"
    mismatch=$((mismatch + 1))
  else
    echo "note: $table counted $expected, restored $actual (changed while the backup ran)"
  fi
done <"$counts"

tables="$(grep -c . "$counts")"
if [ "$mismatch" -gt 0 ]; then
  echo "restore FAILED verification: $mismatch of $tables tables wrong (see above)" >&2
  exit 1
fi
echo "restore verified: all $tables tables present with the backup's row counts"
