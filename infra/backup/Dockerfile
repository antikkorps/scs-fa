# syntax=docker/dockerfile:1
# Postgres logical-backup sidecar: pg_dump on a cron schedule → age-encrypted →
# S3, with rotation; a daily encrypted copy of the app's S3 objects (rclone);
# and the daily purge of Umami audience data past its 25-month retention.
# Based on postgres:18-alpine so pg_dump matches the prod server major version.
FROM postgres:18-alpine

# aws-cli (alpine community) talks to any S3-compatible endpoint (Scaleway here);
# age encrypts the dumps to a public key; rclone copies the objects, encrypted.
RUN apk add --no-cache aws-cli age rclone

COPY backup.sh restore.sh backup-objects.sh restore-objects.sh rclone-env.sh entrypoint.sh umami-purge.sh /usr/local/bin/
COPY umami-purge.sql /usr/local/share/
RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh /usr/local/bin/backup-objects.sh \
  /usr/local/bin/restore-objects.sh /usr/local/bin/entrypoint.sh /usr/local/bin/umami-purge.sh

# crond is PID 1 so cron job stdout/stderr (redirected to /proc/1/fd/*) surface
# in `docker logs`. A simple "is the scheduler alive" healthcheck.
HEALTHCHECK --interval=1m --timeout=5s --retries=3 CMD pgrep crond >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
