# Sourced by the object backup scripts: two rclone remotes, configured from the
# environment so no config file holds a secret (story 12.9f).
#   store:  the S3 endpoint, with the app's credentials
#   vault:  store:<bucket>/<objects prefix>, encrypted (names and content)
# shellcheck shell=sh

: "${S3_ENDPOINT:?S3_ENDPOINT required}"
: "${S3_REGION:?S3_REGION required}"
: "${S3_BUCKET:?S3_BUCKET required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}"
: "${BACKUP_OBJECTS_PASSWORD:?BACKUP_OBJECTS_PASSWORD required}"
BACKUP_OBJECTS_PREFIX="${BACKUP_OBJECTS_PREFIX:-backups/objects}"
# The bucket the app stores its objects in; the backups default to the same one.
APP_S3_BUCKET="${APP_S3_BUCKET:-${S3_BUCKET}}"

# No config file at all: everything comes from the variables below.
export RCLONE_CONFIG=/dev/null
export RCLONE_CONFIG_STORE_TYPE=s3
export RCLONE_CONFIG_STORE_PROVIDER=Other
export RCLONE_CONFIG_STORE_ENDPOINT="${S3_ENDPOINT}"
export RCLONE_CONFIG_STORE_REGION="${S3_REGION}"
export RCLONE_CONFIG_STORE_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID}"
export RCLONE_CONFIG_STORE_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY}"
# The bucket exists already, and the key may not be allowed to create one.
export RCLONE_CONFIG_STORE_NO_CHECK_BUCKET=true

export RCLONE_CONFIG_VAULT_TYPE=crypt
export RCLONE_CONFIG_VAULT_REMOTE="store:${S3_BUCKET}/${BACKUP_OBJECTS_PREFIX}"
RCLONE_CONFIG_VAULT_PASSWORD="$(rclone obscure "${BACKUP_OBJECTS_PASSWORD}")"
export RCLONE_CONFIG_VAULT_PASSWORD
