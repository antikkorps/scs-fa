#!/bin/sh
# Boot the backup scheduler. busybox crond runs jobs with a bare environment, so
# we persist the container's env to a file the scripts source on each run.
set -eu

BACKUP_CRON="${BACKUP_CRON:-0 3 * * *}"   # daily at 03:00 UTC
RETENTION_COUNT="${RETENTION_COUNT:-14}"

# If invoked with a command (e.g. `run --rm backup backup.sh`), run it directly.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

# Persist env (export -p quotes values safely) for cron-launched jobs.
export -p > /etc/backup.env

# crond is PID 1 → redirect job output to the container's stdout/stderr.
echo "${BACKUP_CRON} /usr/local/bin/backup.sh >/proc/1/fd/1 2>/proc/1/fd/2" > /etc/crontabs/root

echo "[backup] scheduler up — cron='${BACKUP_CRON}', retention=${RETENTION_COUNT} dumps"
echo "[backup] on-demand: docker compose run --rm backup backup.sh | restore.sh [file]"

# -f foreground, -l 8 log cron activity to stderr.
exec crond -f -l 8
