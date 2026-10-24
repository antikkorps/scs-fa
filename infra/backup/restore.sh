#!/bin/sh
# Restore a dump from S3 into the database. DESTRUCTIVE: --clean drops objects
# before recreating them. The backup role may not write, and the server does not
# hold the key that decrypts the dumps (story 12.9f): run it as the schema owner,
# with the age private key mounted at /run/age-identity — `just restore [file]`
# does both (docs/DEPLOY.md § Backups).
set -eu
set -o pipefail

[ -f /etc/backup.env ] && . /etc/backup.env

: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${PGDATABASE:?}"
: "${S3_BUCKET:?}" "${S3_ENDPOINT:?}" "${S3_REGION:?}"
: "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-backups/postgres}"
AGE_IDENTITY="${BACKUP_AGE_IDENTITY:-/run/age-identity}"
[ -r "${AGE_IDENTITY}" ] || {
  echo "[restore] no age private key at ${AGE_IDENTITY}: mount it (just restore does)" >&2
  exit 1
}

aws_s3() { aws --endpoint-url "${S3_ENDPOINT}" --region "${S3_REGION}" s3 "$@"; }

file="${1:-}"
if [ -z "${file}" ]; then
  file="$(aws_s3 ls "s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/" \
    | awk '{print $4}' | grep "^${PGDATABASE}_.*\.dump\.age$" | sort -r | head -n1)"
  [ -n "${file}" ] || { echo "no backups found under ${BACKUP_S3_PREFIX}/"; exit 1; }
  echo "[restore] latest backup: ${file}"
fi

tmp="/tmp/${file%.age}"
echo "[restore] downloading and decrypting s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/${file}"
aws_s3 cp "s3://${S3_BUCKET}/${BACKUP_S3_PREFIX}/${file}" - | age -d -i "${AGE_IDENTITY}" -o "${tmp}"

echo "[restore] restoring into ${PGDATABASE}@${PGHOST} (--clean --if-exists)"
pg_restore -h "${PGHOST}" -U "${PGUSER}" -d "${PGDATABASE}" \
  --clean --if-exists --no-owner --no-privileges "${tmp}"
rm -f "${tmp}"
echo "[restore] done"
