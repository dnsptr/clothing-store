#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.production"
BACKEND_HOST="${BACKEND_HOST:?BACKEND_HOST is required, e.g. api.example.com}"
PUBLIC_BACKEND_URL="${PUBLIC_BACKEND_URL:-https://${BACKEND_HOST}}"
STOREFRONT_URL="${STOREFRONT_URL:?STOREFRONT_URL is required, e.g. https://your-storefront.vercel.app}"

cd "${PROJECT_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  umask 077
  cat > "${ENV_FILE}" <<EOF
BACKEND_HOST=${BACKEND_HOST}
STOREFRONT_URL=${STOREFRONT_URL}

POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)

STORE_CORS=${STOREFRONT_URL}
ADMIN_CORS=${PUBLIC_BACKEND_URL}
AUTH_CORS=${STOREFRONT_URL},${PUBLIC_BACKEND_URL}
EOF
fi

if ! grep -q '^STOREFRONT_URL=' "${ENV_FILE}"; then
  printf '\nSTOREFRONT_URL=%s\n' "${STOREFRONT_URL}" >> "${ENV_FILE}"
fi

# Пароль админки генерируется здесь же. Раньше скрипт записывал строку
# `# ADMIN_BASIC_AUTH_HASH=replace-with-...` закомментированной, а
# compose.production.yml объявляет эту переменную обязательной через
# `${ADMIN_BASIC_AUTH_HASH:?}` — первый деплой на чистой машине падал целиком,
# и понять причину по сообщению compose было нельзя.
if ! grep -q '^ADMIN_BASIC_AUTH_HASH=' "${ENV_FILE}"; then
  ADMIN_PASSWORD="$(openssl rand -base64 24)"
  ADMIN_HASH="$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "${ADMIN_PASSWORD}")"

  # `$` в значении обязан быть удвоен: compose раскрывает `$VAR` в файле,
  # переданном через `--env-file`, а bcrypt-хеш всегда имеет вид
  # `$2a$14$<соль+хеш>`. Часть после третьего `$` — синтаксически корректное
  # имя переменной, поэтому compose подставлял вместо неё пустую строку, и в
  # Caddy уходил обрубок: `$2a$14$e4td…/f65tVcyCy6i` → `$2a$14/f65tVcyCy6i`.
  # Хеш переставал быть валидным bcrypt, и пароль, который скрипт печатает
  # ниже как «сохраните прямо сейчас», не подходил никогда. Обнаружено на
  # restore drill 2026-07-27, проверено чтением переменной изнутри контейнера.
  printf '\nADMIN_BASIC_AUTH_HASH=%s\n' "${ADMIN_HASH//\$/\$\$}" >> "${ENV_FILE}"

  echo
  echo "======================================================================"
  echo " Создан пароль базовой аутентификации админки (логин: admin)"
  echo
  echo "   ${ADMIN_PASSWORD}"
  echo
  echo " Он показан ОДИН раз — в .env.production попадает только хеш."
  echo " Сохраните его в менеджере паролей прямо сейчас."
  echo "======================================================================"
  echo
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f compose.production.yml "$@"
}

# Конфигурация проверяется до сборки: раньше опечатка или недостающая
# обязательная переменная обнаруживались после нескольких минут сборки образа
# на прод-машине с 2 vCPU.
compose config --quiet

compose build medusa
compose up -d postgres redis

# Дамп перед миграциями. Миграция необратима, и до этой правки она выполнялась
# в CMD при каждом старте контейнера — без резервной копии и без возможности
# вернуться: предыдущий образ перезаписывался сборкой.
echo "Снимаем дамп базы перед миграциями…"
mkdir -p "${PROJECT_DIR}/backups"
PRE_MIGRATION_DUMP="${PROJECT_DIR}/backups/pre-migration_$(date +%Y%m%d_%H%M%S).dump.gz"
if compose exec -T postgres pg_dump -U medusa -Fc medusa_backend | gzip > "${PRE_MIGRATION_DUMP}"; then
  echo "Дамп сохранён: ${PRE_MIGRATION_DUMP}"
else
  rm -f "${PRE_MIGRATION_DUMP}"
  echo "Не удалось снять дамп перед миграциями — деплой остановлен." >&2
  echo "Если база ещё не создана (первый деплой), запустите: SKIP_PRE_MIGRATION_DUMP=1 $0" >&2
  [[ "${SKIP_PRE_MIGRATION_DUMP:-}" == "1" ]] || exit 1
fi

# Миграции — отдельный шаг с проверяемым результатом. Падение здесь оставляет
# работающую старую версию, а не бесконечный цикл перезапусков.
echo "Применяем миграции…"
if ! compose run --rm --no-deps medusa npx medusa db:migrate; then
  echo "Миграции не применились. Приложение не обновлено." >&2
  echo "Восстановление: scripts/restore-db.sh ${PRE_MIGRATION_DUMP}" >&2
  exit 1
fi

compose up -d
