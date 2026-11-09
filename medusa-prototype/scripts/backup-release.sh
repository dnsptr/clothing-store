#!/usr/bin/env bash
set -euo pipefail
umask 077

# Read-only snapshot. The recipient's private key must stay off this host.
SOURCE_DIR="${1:?Usage: backup-release.sh <live-project-dir> <recipient-certificate.pem> <backup-dir>}"
RECIPIENT="${2:?A public recipient certificate is required}"
OUTPUT_DIR="${3:?A private backup directory is required}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:?Explicit live PostgreSQL container is required}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:?Explicit live backend container is required}"
REDIS_CONTAINER="${REDIS_CONTAINER:?Explicit live Redis container is required}"
DB_USER="${BACKUP_DB_USER:-medusa}"
DB_NAME="${BACKUP_DB_NAME:-medusa_backend}"

SOURCE_DIR="$(realpath "${SOURCE_DIR}")"
RECIPIENT="$(realpath "${RECIPIENT}")"
for file in .env.production compose.production.yml Caddyfile; do
  [[ -f "${SOURCE_DIR}/${file}" ]] || { echo "Missing deployment file: ${file}" >&2; exit 1; }
done
[[ -d "${SOURCE_DIR}/static" ]] || { echo "Missing live media directory" >&2; exit 1; }
openssl x509 -in "${RECIPIENT}" -noout -checkend 0 >/dev/null

# Reject mixed-project application/database/queue identities before reading data.
backend_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "${BACKEND_CONTAINER}")"
postgres_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "${POSTGRES_CONTAINER}")"
redis_project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "${REDIS_CONTAINER}")"
redis_service="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.service"}}' "${REDIS_CONTAINER}")"
redis_dir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "${REDIS_CONTAINER}")"
backend_dir="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "${BACKEND_CONTAINER}")"
[[ -n "${backend_project}" && "${backend_project}" == "${postgres_project}" && "${backend_project}" == "${redis_project}" && "${backend_dir}" == "${SOURCE_DIR}" && "${redis_dir}" == "${SOURCE_DIR}" && "${redis_service}" == "redis" ]] || {
  echo "Container/project-directory mismatch; snapshot refused" >&2; exit 1;
}

mkdir -p "${OUTPUT_DIR}"
OUTPUT_DIR="$(realpath "${OUTPUT_DIR}")"
chmod 700 "${OUTPUT_DIR}"
stage="$(mktemp -d "${OUTPUT_DIR}/.snapshot.XXXXXXXX")"
cleanup() { rm -rf -- "${stage}"; }
trap cleanup EXIT

mkdir -p "${stage}/snapshot/config"
docker exec "${POSTGRES_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" -Fc > "${stage}/snapshot/database.dump"
docker exec -i "${POSTGRES_CONTAINER}" pg_restore --list < "${stage}/snapshot/database.dump" > "${stage}/snapshot/database.list"
# A replication snapshot reads every Redis DB without flushing or changing keys.
# Authentication stays inside the existing container, never in argv or stdout.
docker inspect "${REDIS_CONTAINER}" > "${stage}/snapshot/redis-container.inspect.json"
docker exec "${REDIS_CONTAINER}" sh -ec \
  'export REDISCLI_AUTH="${REDIS_PASSWORD:?Redis password is required}"; exec redis-cli --rdb -' \
  > "${stage}/snapshot/redis.rdb" 2> "${stage}/snapshot/redis-snapshot.log"
docker exec -i "${REDIS_CONTAINER}" sh -ec \
  'rdb="$(mktemp /tmp/release-rdb.XXXXXXXX)"; trap '\''rm -f -- "$rdb"'\'' EXIT; cat > "$rdb"; redis-check-rdb "$rdb"' \
  < "${stage}/snapshot/redis.rdb" > "${stage}/snapshot/redis-check-rdb.txt" 2>&1
image_id="$(docker inspect -f '{{.Image}}' "${BACKEND_CONTAINER}")"
# Compose interpolation can differ from the running container. Preserve the exact
# runtime environment and mount/command metadata only inside the encrypted payload.
docker inspect "${BACKEND_CONTAINER}" > "${stage}/snapshot/backend-container.inspect.json"
printf '%s\n' "${image_id}" > "${stage}/snapshot/backend-image.id"
docker image save "${image_id}" -o "${stage}/snapshot/backend-image.tar"
cp -- "${SOURCE_DIR}/.env.production" "${SOURCE_DIR}/compose.production.yml" "${SOURCE_DIR}/Caddyfile" "${stage}/snapshot/config/"
tar -C "${SOURCE_DIR}" -czf "${stage}/snapshot/static.tar.gz" static
# External Vercel artifacts are not available through a backend snapshot.
printf '%s\n' 'storefront=external; preserve the current Vercel deployment separately' > "${stage}/snapshot/limitations.txt"
(cd "${stage}/snapshot" && sha256sum database.dump backend-image.tar backend-container.inspect.json redis-container.inspect.json redis.rdb redis-check-rdb.txt static.tar.gz config/.env.production config/compose.production.yml config/Caddyfile > SHA256SUMS)
tar -C "${stage}" -czf "${stage}/snapshot.tar.gz" snapshot

name="release-$(date -u +%Y%m%dT%H%M%SZ)"
final="${OUTPUT_DIR}/${name}.tar.gz.cms"
[[ ! -e "${final}" ]] || { echo "Snapshot name already exists" >&2; exit 1; }
# CMS AuthEnvelopedData: standard authenticated encryption, not a custom format.
openssl cms -encrypt -binary -aes-256-gcm -outform DER -in "${stage}/snapshot.tar.gz" -out "${stage}/encrypted.part" "${RECIPIENT}"
sha256sum "${stage}/snapshot.tar.gz" | cut -d ' ' -f 1 > "${stage}/plaintext.sha256"
mv -- "${stage}/encrypted.part" "${final}"
mv -- "${stage}/plaintext.sha256" "${final}.plaintext.sha256"
(cd "${OUTPUT_DIR}" && sha256sum "${name}.tar.gz.cms" > "${name}.tar.gz.cms.sha256")
printf 'Encrypted snapshot: %s\nBackend image: %s\n' "${final}" "${image_id}"
printf '%s\n' 'Redis RDB integrity: redis-check-rdb passed.' 'Copy the encrypted snapshot and checksums off-host; decrypt and rehearse restoration before release.' 'No migrations, restores, container restarts or application-data writes were performed.' 'For coordinated PostgreSQL/Redis recovery, take the final snapshot with backend writers stopped under maintenance.'
