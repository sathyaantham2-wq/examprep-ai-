#!/usr/bin/env bash
# F014: encrypted logical backup of the production database.
#
#   SOURCE_DATABASE_URL=postgres://...  BACKUP_PASSPHRASE=...  scripts/db-backup.sh <out-dir>
#
# Writes two files to <out-dir>:
#   prepplan-<UTC timestamp>.dump.enc   pg_dump custom format, AES-256 (openssl, PBKDF2) encrypted
#   prepplan-<UTC timestamp>.counts     row count per table at dump time, used to verify a restore
# Nothing unencrypted is ever written to disk: pg_dump streams straight into openssl.
#
# Only the `public` schema is dumped. Every table this app owns lives there, including
# better-auth's users/sessions/accounts. Supabase's own schemas (auth, storage, realtime...) are
# platform-managed and recreated by Supabase, so they are not ours to back up or restore.
set -euo pipefail

out_dir="${1:?usage: db-backup.sh <out-dir>}"
: "${SOURCE_DATABASE_URL:?SOURCE_DATABASE_URL is not set}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}"
if [ "${#BACKUP_PASSPHRASE}" -lt 20 ]; then
  echo "BACKUP_PASSPHRASE must be at least 20 characters" >&2
  exit 1
fi

mkdir -p "$out_dir"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
dump="$out_dir/prepplan-$stamp.dump.enc"
counts="$out_dir/prepplan-$stamp.counts"

# Row counts first, from the same database, so a restore can be checked table by table. Taken a
# moment before the dump, so a busy table may legitimately differ by a few rows; the verify step
# reports differences rather than hiding them.
psql "$SOURCE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "
  select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE'
  order by table_name" |
  while read -r table; do
    table="${table%$'\r'}" # psql on Windows ends lines with CRLF
    [ -n "$table" ] || continue
    n="$(psql "$SOURCE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 -c "select count(*) from public.\"$table\"" | tr -d '\r')"
    printf '%s\t%s\n' "$table" "$n"
  done >"$counts"

pg_dump "$SOURCE_DATABASE_URL" \
  --format=custom --schema=public --no-owner --no-privileges --compress=9 |
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$dump"

# A truncated or empty dump must fail the job, not be kept as if it were a backup.
size="$(wc -c <"$dump")"
if [ "$size" -lt 1024 ]; then
  echo "Backup is suspiciously small ($size bytes)" >&2
  exit 1
fi

echo "backup: $dump ($size bytes), $(wc -l <"$counts") tables counted"
