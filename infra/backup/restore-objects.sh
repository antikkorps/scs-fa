#!/bin/sh
# Copy backed-up objects back into the app's bucket (story 12.9f). Only adds or
# overwrites; it never deletes what the bucket holds now. Usage:
#   restore-objects.sh               every object of the latest copy
#   restore-objects.sh YYYY-MM-DD    what that day's run saw deleted or overwritten
set -eu

[ -f /etc/backup.env ] && . /etc/backup.env
. /usr/local/bin/rclone-env.sh

source="vault:current"
if [ -n "${1:-}" ]; then
  source="vault:deleted/$1"
fi

echo "[restore-objects] ${source} → ${APP_S3_BUCKET}"
rclone copy "${source}" "store:${APP_S3_BUCKET}" --stats-one-line --stats 0
echo "[restore-objects] done"
