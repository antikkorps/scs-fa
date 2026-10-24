#!/bin/sh
# Daily copy of the app's S3 objects (identity documents, images) — story 12.9f.
# Encrypted with rclone crypt into <bucket>/backups/objects/:
#   current/             the objects as they are today
#   deleted/YYYY-MM-DD/  what that day's run saw deleted or overwritten
# A deleted folder is pruned after BACKUP_OBJECTS_RETENTION_DAYS, so an object
# purged from the shop (privacy retention) leaves the backups that long after.
set -eu

# Cron runs jobs with a bare environment; entrypoint persisted ours here.
[ -f /etc/backup.env ] && . /etc/backup.env
. /usr/local/bin/rclone-env.sh
RETENTION_DAYS="${BACKUP_OBJECTS_RETENTION_DAYS:-30}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups/postgres}"

log() { echo "[backup-objects $(date -u +%H:%M:%S)] $*"; }

today="$(date -u +%Y-%m-%d)"
log "syncing ${APP_S3_BUCKET} → ${S3_BUCKET}/${BACKUP_OBJECTS_PREFIX}/current (encrypted)"
# The backups themselves live in the same bucket by default: never copy them.
rclone sync "store:${APP_S3_BUCKET}" vault:current \
  --exclude "/${BACKUP_S3_PREFIX}/**" \
  --exclude "/${BACKUP_OBJECTS_PREFIX}/**" \
  --backup-dir "vault:deleted/${today}" \
  --stats-one-line --stats 0

# Folder names are dates (YYYY-MM-DD), so a string comparison orders them.
cutoff="$(date -u -d "@$(($(date -u +%s) - RETENTION_DAYS * 86400))" +%Y-%m-%d)"
log "pruning deleted-objects folders older than ${cutoff} (${RETENTION_DAYS} days)"
rclone lsf --dirs-only vault:deleted/ 2>/dev/null | tr -d / | while read -r day; do
  if [ "${day}" \< "${cutoff}" ]; then
    log "  purge deleted/${day}"
    rclone purge "vault:deleted/${day}"
  fi
done

log "done"
