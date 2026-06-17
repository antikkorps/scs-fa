# syntax=docker/dockerfile:1
# Postgres logical-backup sidecar: pg_dump on a cron schedule → S3, with rotation.
# Based on postgres:17-alpine so pg_dump matches the prod server major version.
FROM postgres:17-alpine

# aws-cli (alpine community) talks to any S3-compatible endpoint (Scaleway here).
RUN apk add --no-cache aws-cli

COPY backup.sh restore.sh entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/entrypoint.sh

# crond is PID 1 so cron job stdout/stderr (redirected to /proc/1/fd/*) surface
# in `docker logs`. A simple "is the scheduler alive" healthcheck.
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD pgrep crond >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
