#!/bin/sh
# Restore drill: proves the latest dump can be brought back, without touching
# the live database. The dump is restored into a throwaway Postgres started
# inside this container, then its row counts are compared with the live ones,
# read as scs_backup (which may not write). Needs the age private key mounted
# at /run/age-identity — `just restore-drill <key>` takes a fresh dump first,
# so any difference means a write landed in between, or a broken backup.
set -eu
set -o pipefail

[ -f /etc/backup.env ] && . /etc/backup.env

: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${S3_BUCKET:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups/postgres}"
AGE_IDENTITY="${BACKUP_AGE_IDENTITY:-/run/age-identity}"
[ -r "${AGE_IDENTITY}" ] || {
  echo "[drill] no age private key at ${AGE_IDENTITY}: mount it (just restore-drill does)" >&2
  exit 1
}

log() { echo "[drill $(date -u +%H:%M:%S)] $*"; }
aws_s3() { aws --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}" s3 "$@"; }

file="${1:-}"
if [ -z "${file}" ]; then
  file="$(aws_s3 ls "s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/" \
    | awk '{print $4}' | grep "^${PGDATABASE}_.*\.dump\.age$" | sort -r | head -n1)"
  [ -n "${file}" ] || { echo "[drill] no backups found under ${BACKUP_S3_PREFIX}/" >&2; exit 1; }
fi

# The throwaway server: a fresh cluster on a Unix socket only, gone with the container.
DRILL_DIR=/tmp/drill
SOCKET="${DRILL_DIR}/socket"
mkdir -p "${SOCKET}"
chown -R postgres:postgres "${DRILL_DIR}"
gosu postgres initdb -D "${DRILL_DIR}/data" --auth=trust -U postgres --no-locale -E UTF8 >/dev/null 2>&1
gosu postgres pg_ctl -D "${DRILL_DIR}/data" -o "-c listen_addresses='' -k ${SOCKET}" -w -l "${DRILL_DIR}/server.log" start >/dev/null
trap 'gosu postgres pg_ctl -D "${DRILL_DIR}/data" -m immediate stop >/dev/null 2>&1 || true' EXIT
gosu postgres createdb -h "${SOCKET}" -U postgres drill

log "restoring ${file} into a throwaway database"
start="$(date +%s)"
# Streamed, like restore.sh: the decrypted dump never touches the disk.
aws_s3 cp "s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/${file}" - \
  | age -d -i "${AGE_IDENTITY}" \
  | pg_restore -h "${SOCKET}" -U postgres -d drill --no-owner --no-privileges --single-transaction --exit-on-error
log "restored in $(($(date +%s) - start)) s"

# One line per table of the public schema: "<table> <rows>".
COUNT_ROWS="select table_name || ' ' || (xpath('/row/c/text()', query_to_xml(
  format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE' order by 1"

psql -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -tAq -v ON_ERROR_STOP=1 -c "${COUNT_ROWS}" > "${DRILL_DIR}/live.txt"
psql -h "${SOCKET}" -U postgres -d drill -tAq -v ON_ERROR_STOP=1 -c "${COUNT_ROWS}" > "${DRILL_DIR}/restored.txt"

tables="$(wc -l < "${DRILL_DIR}/restored.txt" | tr -d ' ')"
rows="$(awk '{sum += $2} END {print sum + 0}' "${DRILL_DIR}/restored.txt")"
# "<table> live=<n> restored=<n>" for every table whose count differs or that only one side has.
awk '
  FNR == NR { live[$1] = $2; next }
  { restored[$1] = $2 }
  END {
    for (t in live) if (live[t] != restored[t]) printf "  %s live=%s restored=%s\n", t, live[t], (t in restored ? restored[t] : "missing")
    for (t in restored) if (!(t in live)) printf "  %s live=missing restored=%s\n", t, restored[t]
  }
' "${DRILL_DIR}/live.txt" "${DRILL_DIR}/restored.txt" > "${DRILL_DIR}/differences.txt"

if [ ! -s "${DRILL_DIR}/differences.txt" ]; then
  log "drill passed: ${tables} tables, ${rows} rows, identical to the live database"
  exit 0
fi
log "drill FAILED: the restored database differs from the live one:"
cat "${DRILL_DIR}/differences.txt"
exit 1
