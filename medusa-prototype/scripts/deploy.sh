#!/usr/bin/env bash

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${PROJECT_DIR}/.env.production"
BACKEND_HOST="${BACKEND_HOST:?BACKEND_HOST is required, e.g. 1-2-3-4.sslip.io or your domain}"
PUBLIC_BACKEND_URL="${PUBLIC_BACKEND_URL:-https://${BACKEND_HOST}}"
STOREFRONT_URL="${STOREFRONT_URL:?STOREFRONT_URL is required, e.g. https://your-storefront.vercel.app}"

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

# Generate with: docker run --rm caddy:2-alpine caddy hash-password --plaintext '<password>'
# ADMIN_BASIC_AUTH_HASH=replace-with-caddy-hash-password-output

STORE_CORS=${STOREFRONT_URL}
ADMIN_CORS=${PUBLIC_BACKEND_URL}
AUTH_CORS=${STOREFRONT_URL},${PUBLIC_BACKEND_URL}
EOF
fi

docker compose --env-file "${ENV_FILE}" -f compose.production.yml up -d --build
