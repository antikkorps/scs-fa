#!/bin/sh
# Delete Umami audience data older than 25 months (see umami-purge.sql).
# Runs daily from the backup sidecar's cron; skipped while Umami is not set up.
set -eu

# Cron runs jobs with a bare environment; entrypoint persisted ours here.
[ -f /etc/backup.env ] && . /etc/backup.env

: "${PGDATABASE:?PGDATABASE required}"

UMAMI_DATABASE="${UMAMI_DATABASE:-umami}"

if [ "$(psql -d "$PGDATABASE" -tAc "SELECT 1 FROM pg_database WHERE datname = '${UMAMI_DATABASE}'")" != "1" ]; then
  echo "[umami-purge] no '${UMAMI_DATABASE}' database yet — skipped"
  exit 0
fi

echo "[umami-purge] deleting audience data older than 25 months"
# As Umami's own role: the backup role may not delete anything (story 12.9f).
: "${UMAMI_PGPASSWORD:?UMAMI_PGPASSWORD required}"
PGUSER="${UMAMI_PGUSER:-umami}" PGPASSWORD="${UMAMI_PGPASSWORD}" \
  psql -d "$UMAMI_DATABASE" -v ON_ERROR_STOP=1 -f /usr/local/share/umami-purge.sql
echo "[umami-purge] done"
