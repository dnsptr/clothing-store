#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_FILE="${1:?Usage: restore-db.sh <path-to-backup.sql.gz>}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

# Resolve to an absolute path before changing directory so a relative
# argument keeps working once we cd into the project root.
BACKUP_FILE="$(cd "$(dirname "${BACKUP_FILE}")" && pwd)/$(basename "${BACKUP_FILE}")"

cd "${PROJECT_DIR}"

gunzip -c "${BACKUP_FILE}" \
  | docker compose -f compose.production.yml exec -T postgres psql -U medusa -d medusa_backend
