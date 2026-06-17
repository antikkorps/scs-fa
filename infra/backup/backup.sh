#!/bin/sh
# One backup cycle: pg_dump → upload to S3 → prune old backups by retention count.
# Runs both from cron and on-demand (`docker compose run --rm backup backup.sh`).
set -eu

# Cron runs jobs with a bare environment; entrypoint persisted ours here.
[ -f /etc/backup.env ] && . /etc/backup.env

: "${PGHOST:?PGHOST required}"
: "${PGUSER:?PGUSER required}"
: "${PGPASSWORD:?PGPASSWORD required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${S3_BUCKET:?S3_BUCKET required}"
: "${S3_ENDPOINT:?S3_ENDPOINT required}"
: "${S3_REGION:?S3_REGION required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups/postgres}"
RETENTION_COUNT="${RETENTION_COUNT:-14}"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
file="${PGDATABASE}_${ts}.dump"
tmp="/tmp/${file}"
dest="s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/${file}"

aws_s3() { aws --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}" s3 "$@"; }

log() { echo "[backup $(date -u +%H:%M:%S)] $*"; }

log "dumping ${PGDATABASE}@${PGHOST} → ${file} (custom format, compressed)"
# -Fc: custom archive (selective pg_restore, parallelism). -Z9: max compression.
pg_dump -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" -Fc -Z9 -f "${tmp}"
size="$(du -h "${tmp}" | cut -f1)"

log "uploading ${size} → ${dest}"
aws_s3 cp "${tmp}" "${dest}"
rm -f "${tmp}"

# Prune: keep the newest RETENTION_COUNT dumps, delete the rest. Filenames are
# timestamped (YYYYMMDDT…Z) so lexical sort == chronological.
log "pruning: keep newest ${RETENTION_COUNT}"
aws_s3 ls "s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/" \
  | awk '{print $4}' \
  | grep "^${PGDATABASE}_.*\.dump$" \
  | sort -r \
  | tail -n +"$((RETENTION_COUNT + 1))" \
  | while read -r old; do
      log "  rm ${old}"
      aws_s3 rm "s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/${old}"
    done

log "done: ${dest}"
