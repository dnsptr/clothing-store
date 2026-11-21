#!/usr/bin/env bash
set -euo pipefail
umask 077

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:?Usage: restore-candidate.sh <candidate.env> <decrypted-snapshot-dir> <mm-closeout-*|mm-rollback-*>}"
SNAPSHOT="${2:?A verified decrypted snapshot directory is required}"
PROJECT="${3:?An explicitly named disposable project is required}"
case "${PROJECT}" in mm-closeout-*|mm-rollback-*) ;; *) echo "Refusing a non-rehearsal project name" >&2; exit 1 ;; esac
[[ "${PROJECT}" =~ ^[a-z0-9][a-z0-9_-]+$ ]] || { echo "Invalid project name" >&2; exit 1; }
ENV_FILE="$(realpath "${ENV_FILE}")"
SNAPSHOT="$(realpath "${SNAPSHOT}")"
[[ -f "${SNAPSHOT}/SHA256SUMS" && -f "${SNAPSHOT}/database.dump" && -f "${SNAPSHOT}/static.tar.gz" ]] || { echo "Incomplete snapshot" >&2; exit 1; }
(cd "${SNAPSHOT}" && sha256sum -c SHA256SUMS)
compose() { docker compose --env-file "${ENV_FILE}" -f "${PROJECT_DIR}/compose.candidate.yml" -p "${PROJECT}" "$@"; }
compose config --quiet
compose up -d --wait --wait-timeout 60 postgres redis

# Restore into an empty isolated database, not --clean into a newer schema.
# pg_restore --clean only drops objects present in the old dump; newer tables survive.
identity="$(compose exec -T postgres psql -U medusa_candidate -d medusa_candidate -Atc 'SELECT current_database() || chr(58) || current_user')"
[[ "${identity//$'\r'/}" == "medusa_candidate:medusa_candidate" ]] || { echo "Unexpected restore target" >&2; exit 1; }
tables="$(compose exec -T postgres psql -U medusa_candidate -d medusa_candidate -Atc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
[[ "${tables//$'\r'/}" == "0" ]] || { echo "Target is not empty; use a new rehearsal project, not an in-place rollback" >&2; exit 1; }
volume="${PROJECT}_static_data"
docker volume create --label "com.docker.compose.project=${PROJECT}" --label com.docker.compose.volume=static_data "${volume}" >/dev/null
docker run --rm --network none --mount "type=volume,src=${volume},dst=/candidate-static" --entrypoint sh postgres:15-alpine -c 'test -z "$(find /candidate-static -mindepth 1 -maxdepth 1 -print -quit)"' || {
  echo "Media target is not empty; restore refused" >&2; exit 1;
}
compose exec -T postgres pg_restore -U medusa_candidate -d medusa_candidate --no-owner --no-privileges --exit-on-error < "${SNAPSHOT}/database.dump"
docker run --rm --network none --mount "type=volume,src=${volume},dst=/candidate-static" --mount "type=bind,src=${SNAPSHOT}/static.tar.gz,dst=/input.tar.gz,readonly" --entrypoint sh postgres:15-alpine -c 'tar -xzf /input.tar.gz -C /candidate-static --strip-components=1 && chown -R 1000:1000 /candidate-static'
echo "Database and media restored into ${PROJECT}; no application started and no migrations executed."
echo "Review script_migrations before upgrading; old-image rollback must use the matching old media mount and configuration."
