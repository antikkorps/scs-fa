#!/bin/sh
# End-to-end check of the backup image (story 12.9f), with Docker only: a
# throwaway Postgres, an S3 endpoint served by the image's own rclone, then
#   - backup.sh dumps as scs_backup and uploads an age-encrypted dump;
#   - backup-objects.sh copies the app's objects encrypted, keeps deleted ones
#     in a dated folder, and prunes the folders past their retention;
#   - restore.sh (owner role + private key) and restore-objects.sh bring both back.
# Usage, from the repo root: `just check-backup`.
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
NET=scs-backup-check
PG=scs-backup-check-pg
S3=scs-backup-check-s3
IMAGE=scs-backup:check
DB=armurier_prod
BUCKET=shop
# rclone serve s3 does not recognise very short access keys.
S3_KEY=AKIACHECKKEY0001
S3_SECRET=checksecretcheckseccretcheck0001
WORK="$(mktemp -d)"

failures=0
pass() { echo "  ok   $*"; }
fail() { echo "  FAIL $*"; failures=$((failures + 1)); }

cleanup() {
  docker rm -f "$PG" "$S3" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cleanup
mkdir -p "$WORK"

echo "[check-backup] building the backup image"
docker build -q -t "$IMAGE" "$ROOT/infra/backup" >/dev/null
docker network create "$NET" >/dev/null

docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=armurier -e POSTGRES_PASSWORD=armurier_pw -e POSTGRES_DB="$DB" \
  postgres:18-alpine >/dev/null
docker run -d --name "$S3" --network "$NET" --entrypoint sh "$IMAGE" \
  -c "mkdir -p /data/${BUCKET} && exec rclone serve s3 /data --addr :9000 --dir-cache-time 1ms --auth-key ${S3_KEY},${S3_SECRET}" >/dev/null
until docker exec "$PG" pg_isready -h localhost -U armurier -d "$DB" >/dev/null 2>&1; do sleep 1; done

docker exec -i "$PG" psql -h localhost -U armurier -d "$DB" -q \
  -v db="$DB" -v owner_password=owner_pw -v app_password=app_pw -v backup_password=backup_pw \
  < "$ROOT/infra/postgres/roles.sql"
owner_sql() { docker exec -e PGPASSWORD=owner_pw "$PG" psql -h localhost -U scs_owner -d "$DB" -tAq -v ON_ERROR_STOP=1 -c "$1"; }
app_sql() { docker exec -e PGPASSWORD=app_pw "$PG" psql -h localhost -U scs_app -d "$DB" -tAq -v ON_ERROR_STOP=1 -c "$1"; }
owner_sql "CREATE TABLE secrets (id int PRIMARY KEY, note text)"
owner_sql "INSERT INTO secrets VALUES (1, 'needle-row')"

# The key pair: the server only ever gets the public half.
docker run --rm --entrypoint age-keygen "$IMAGE" > "$WORK/identity.txt" 2>/dev/null
recipient="$(grep -o 'age1[a-z0-9]*' "$WORK/identity.txt")"

# The backup container as the stack runs it, plus whatever the step adds.
backup_run() {
  docker run --rm --network "$NET" \
    -e PGHOST="$PG" -e PGUSER=scs_backup -e PGPASSWORD=backup_pw -e PGDATABASE="$DB" \
    -e AWS_ACCESS_KEY_ID="$S3_KEY" -e AWS_SECRET_ACCESS_KEY="$S3_SECRET" \
    -e AWS_REQUEST_CHECKSUM_CALCULATION=when_required -e AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    -e S3_ENDPOINT="http://${S3}:9000" -e S3_REGION=us-east-1 -e S3_BUCKET="$BUCKET" \
    -e BACKUP_AGE_RECIPIENT="$recipient" -e BACKUP_OBJECTS_PASSWORD=objects-passphrase \
    -e BACKUP_OBJECTS_RETENTION_DAYS=30 \
    "$@"
}
# Raw S3 access, as anyone holding the bucket's keys would see it.
s3() { backup_run --entrypoint aws "$IMAGE" --endpoint-url "http://${S3}:9000" --region us-east-1 s3 "$@"; }

printf 'needle-document' > "$WORK/passport.pdf"
docker cp "$WORK/passport.pdf" "$S3:/data/${BUCKET}/legal-documents-passport.pdf"
docker exec "$S3" sh -c "mkdir -p /data/${BUCKET}/legal-documents && mv /data/${BUCKET}/legal-documents-passport.pdf /data/${BUCKET}/legal-documents/passport.pdf"

echo "[check-backup] database dump"
if backup_run "$IMAGE" backup.sh >"$WORK/backup.log" 2>&1; then pass "backup.sh runs as scs_backup"; else fail "backup.sh failed: $(tail -3 "$WORK/backup.log")"; fi
dump="$(s3 ls "s3://${BUCKET}/backups/postgres/" 2>/dev/null | awk '{print $4}' | grep '\.dump\.age$' | head -n1 || true)"
if [ -n "$dump" ]; then pass "an encrypted dump is uploaded (${dump})"; else fail "no .dump.age under backups/postgres/"; fi
if [ -n "$dump" ]; then
  s3 cp "s3://${BUCKET}/backups/postgres/${dump}" - 2>/dev/null > "$WORK/uploaded.dump.age"
  if head -c 5 "$WORK/uploaded.dump.age" | grep -q PGDMP || grep -q needle-row "$WORK/uploaded.dump.age"; then
    fail "the uploaded dump is readable without the key"
  else
    pass "the uploaded dump is unreadable without the key"
  fi
fi

echo "[check-backup] database restore"
owner_sql "DROP TABLE secrets"
if backup_run -e PGUSER=scs_owner -e PGPASSWORD=owner_pw -v "$WORK/identity.txt:/run/age-identity:ro" \
  "$IMAGE" restore.sh >"$WORK/restore.log" 2>&1; then
  pass "restore.sh runs as scs_owner with the private key"
else
  fail "restore.sh failed: $(tail -3 "$WORK/restore.log")"
fi
if [ "$(app_sql "SELECT note FROM secrets WHERE id = 1" 2>/dev/null)" = "needle-row" ]; then
  pass "the restored rows are back, and scs_app may read them"
else
  fail "the restored rows are missing or unreadable by scs_app"
fi
if backup_run -e PGUSER=scs_owner -e PGPASSWORD=owner_pw "$IMAGE" restore.sh >/dev/null 2>&1; then
  fail "restore.sh should refuse to run without the private key"
else
  pass "restore.sh refuses to run without the private key"
fi

echo "[check-backup] objects"
if backup_run "$IMAGE" backup-objects.sh >"$WORK/objects.log" 2>&1; then pass "backup-objects.sh runs"; else fail "backup-objects.sh failed: $(tail -3 "$WORK/objects.log")"; fi
docker exec "$S3" sh -c "find /data/${BUCKET}/backups/objects -type f" > "$WORK/object-copies.txt" 2>/dev/null || true
if [ -s "$WORK/object-copies.txt" ]; then pass "objects are copied under backups/objects/"; else fail "nothing under backups/objects/"; fi
if grep -q passport "$WORK/object-copies.txt" ||
  docker exec "$S3" sh -c "grep -rl needle-document /data/${BUCKET}/backups/objects" >/dev/null 2>&1; then
  fail "object copies leak their name or content"
else
  pass "object copies hide their name and content"
fi
if docker exec "$S3" sh -c "find /data/${BUCKET}/backups/objects -path '*backups*backups*'" | grep -q .; then
  fail "the backups prefix was copied into itself"
else
  pass "the backups prefix is left out of the copy"
fi

docker exec "$S3" rm "/data/${BUCKET}/legal-documents/passport.pdf"
backup_run "$IMAGE" backup-objects.sh >/dev/null 2>&1
today="$(date -u +%Y-%m-%d)"
if backup_run "$IMAGE" restore-objects.sh "$today" >"$WORK/restore-objects.log" 2>&1 &&
  [ "$(docker exec "$S3" cat "/data/${BUCKET}/legal-documents/passport.pdf" 2>/dev/null)" = "needle-document" ]; then
  pass "an object deleted since is restored from the ${today} folder"
else
  fail "restore-objects.sh ${today} did not bring the deleted object back: $(tail -3 "$WORK/restore-objects.log")"
fi

# A deleted-objects folder far past its retention goes on the next run.
vault() { backup_run --entrypoint sh "$IMAGE" -c ". /usr/local/bin/rclone-env.sh && $1" 2>/dev/null; }
vault "echo old | rclone rcat vault:deleted/2000-01-01/old.txt"
if vault "rclone lsf vault:deleted/" | grep -q 2000-01-01; then
  backup_run "$IMAGE" backup-objects.sh >/dev/null 2>&1
  if vault "rclone lsf vault:deleted/" | grep -q 2000-01-01; then
    fail "a deleted-objects folder past its retention is kept"
  else
    pass "deleted-objects folders past their retention are pruned"
  fi
  if vault "rclone lsf vault:deleted/" | grep -q "$today"; then
    pass "the ${today} folder, within its retention, is kept"
  else
    fail "the ${today} folder should be kept"
  fi
else
  fail "could not plant an old deleted-objects folder"
fi

echo "[check-backup] Umami purge"
if backup_run -e UMAMI_PGPASSWORD=umami_pw "$IMAGE" umami-purge.sh 2>&1 | grep -q skipped; then
  pass "umami-purge.sh skips cleanly while Umami is not set up"
else
  fail "umami-purge.sh should skip while Umami is not set up"
fi

if [ "$failures" -gt 0 ]; then
  echo "[check-backup] ${failures} check(s) failed"
  exit 1
fi
echo "[check-backup] all checks passed"
