# syntax=docker/dockerfile:1
# Postgres logical-backup sidecar: pg_dump on a cron schedule → S3, with rotation.
# Also purges Umami audience data past its 25-month retention, daily.
# Based on postgres:18-alpine so pg_dump matches the prod server major version.
FROM postgres:18-alpine

# aws-cli (alpine community) talks to any S3-compatible endpoint (Scaleway here).
RUN apk add --no-cache aws-cli

COPY backup.sh restore.sh entrypoint.sh umami-purge.sh /usr/local/bin/
COPY umami-purge.sql /usr/local/share/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh /usr/local/bin/umami-purge.sh

# crond is PID 1 so cron job stdout/stderr (redirected to /proc/1/fd/*) surface
# in `docker logs`. A simple "is the scheduler alive" healthcheck.
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD pgrep crond >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
