#!/usr/bin/env bash

# Восстановление базы из бэкапа, созданного сервисом `pg_backup`.
#
# Что здесь было сломано и почему это важно:
#
# 1. `docker compose` вызывался без `--env-file`, а `compose.production.yml`
#    объявляет `POSTGRES_PASSWORD` и ещё четыре переменные обязательными через
#    `${VAR:?...}`. Compose раскрывает их при разборе файла для ЛЮБОЙ команды,
#    включая `exec`, — поэтому скрипт падал на первой же строке. Единственный
#    документированный путь восстановления не запускался ни разу.
#
# 2. Дамп в plain-формате заливался в непустую базу через `psql` без
#    `ON_ERROR_STOP=1`. psql выполняет что может, пропускает конфликты и
#    выходит с кодом 0 — «успешное» восстановление наполовину живой базы.
#
# Теперь формат определяется по имени файла: `.dump.gz` — это `pg_dump -Fc`,
# который восстанавливается через `pg_restore --clean --if-exists`; `.sql.gz`
# поддерживается для бэкапов, снятых до перехода на custom-формат.

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.production"
BACKUP_FILE="${1:?Usage: restore-db.sh <path-to-backup.dump.gz|backup.sql.gz>}"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Env file not found: ${ENV_FILE} (run scripts/deploy.sh first)" >&2
  exit 1
fi

# Resolve to an absolute path before changing directory so a relative
# argument keeps working once we cd into the project root.
BACKUP_FILE="$(cd "$(dirname "${BACKUP_FILE}")" && pwd)/$(basename "${BACKUP_FILE}")"

cd "${PROJECT_DIR}"

compose() {
  docker compose --env-file "${ENV_FILE}" -f compose.production.yml "$@"
}

echo "Restoring ${BACKUP_FILE} into medusa_backend…"

case "${BACKUP_FILE}" in
  *.dump.gz)
    # --clean --if-exists удаляет существующие объекты перед загрузкой, иначе
    # дамп ложится поверх текущих данных и оставляет смесь двух состояний.
    # --exit-on-error превращает частичное восстановление в явную ошибку.
    gunzip -c "${BACKUP_FILE}" \
      | compose exec -T postgres pg_restore \
          -U medusa -d medusa_backend \
          --clean --if-exists --no-owner --no-privileges --exit-on-error
    ;;
  *.sql.gz)
    echo "Plain-format backup detected; restoring with ON_ERROR_STOP." >&2
    gunzip -c "${BACKUP_FILE}" \
      | compose exec -T postgres psql \
          -U medusa -d medusa_backend -v ON_ERROR_STOP=1
    ;;
  *)
    echo "Unsupported backup format: ${BACKUP_FILE} (expected .dump.gz or .sql.gz)" >&2
    exit 1
    ;;
esac

echo "Restore finished. Restart the backend so it picks up the restored schema:"
echo "  docker compose --env-file ${ENV_FILE} -f compose.production.yml restart medusa"
