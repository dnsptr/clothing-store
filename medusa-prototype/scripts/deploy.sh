#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.production"
BACKEND_HOST="${BACKEND_HOST:-5-42-97-122.sslip.io}"
PUBLIC_BACKEND_URL="${PUBLIC_BACKEND_URL:-http://${BACKEND_HOST}}"
STOREFRONT_URL="${STOREFRONT_URL:-http://localhost:3000}"

cd "${PROJECT_DIR}"

if [[ ! -f "${ENV_FILE}" ]]; then
  umask 077
  cat > "${ENV_FILE}" <<EOF
BACKEND_HOST=${BACKEND_HOST}

POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECRET=$(openssl rand -hex 32)
AUTH_MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)

STORE_CORS=http://localhost:3000,${STOREFRONT_URL}
ADMIN_CORS=${PUBLIC_BACKEND_URL}
AUTH_CORS=http://localhost:3000,${STOREFRONT_URL},${PUBLIC_BACKEND_URL}
EOF
fi

docker compose --env-file "${ENV_FILE}" -f compose.production.yml up -d --build
