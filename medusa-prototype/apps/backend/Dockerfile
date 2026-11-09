ARG NODE_VERSION=24.22.2
FROM node:${NODE_VERSION}-bookworm-slim AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
# Keep integrity-checked downloads outside image layers. The shared lock
# serializes full/prod installs on memory-constrained builders.
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm config set maxsockets 5 \
  && npm ci --ignore-scripts --no-audit --no-fund --prefer-offline

# Copy only reviewed build inputs, never local env, uploads or cached output.
# Test sources and fixtures are excluded by the root .dockerignore.
COPY apps/backend/src ./apps/backend/src
COPY apps/backend/medusa-config.ts apps/backend/tsconfig.json apps/backend/instrumentation.ts ./apps/backend/
RUN NODE_ENV=production MEDUSA_DISABLE_TELEMETRY=true npm --workspace @dtc/backend run build

FROM node:${NODE_VERSION}-bookworm-slim AS production-deps

ENV NODE_ENV=production
WORKDIR /workspace
# Reuse the reviewed workspace lock and its security overrides. Resolving a
# second standalone lock during the build can produce a tree npm ci rejects.
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
  npm config set maxsockets 5 \
  && npm ci --ignore-scripts --omit=dev --no-audit --no-fund --prefer-offline
COPY --from=builder /workspace/apps/backend/.medusa/server ./apps/backend

FROM node:${NODE_VERSION}-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app/apps/backend

COPY apps/backend/certificates/ /usr/local/share/ca-certificates/
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY --chown=node:node --from=production-deps /workspace/apps/backend ./
COPY --chown=node:node --from=production-deps /workspace/package.json /workspace/package-lock.json /app/
COPY --chown=node:node --from=production-deps /workspace/node_modules /app/node_modules
RUN mkdir -p /app/apps/backend/static \
  && chown node:node /app/apps/backend /app/apps/backend/static

# Процесс не должен быть root: на этом хосте контейнер работает в
# `network_mode: host` и рядом лежат `.env.production` с секретами и каталог с
# дампами БД. RCE в приложении не обязана сразу становиться root на машине.
USER node

EXPOSE 9000

# Без healthcheck зависший процесс не отличим от живого: Caddy продолжает
# проксировать в мёртвый upstream, а `restart: unless-stopped` не срабатывает,
# потому что контейнер формально запущен. Node 24 умеет fetch, поэтому curl в
# образ тащить не нужно.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:9000/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Миграции больше не выполняются при каждом старте. Раньше они стояли в CMD, и
# неудачная миграция вместе с `restart: unless-stopped` давала бесконечный цикл
# перезапусков, а отката не существовало: предыдущий образ перезаписывался
# сборкой, в registry его не было, `/opt/mario-mikke` не привязан к коммиту.
# Теперь миграции — отдельный проверяемый шаг деплоя (scripts/deploy.sh),
# выполняемый после дампа базы.
CMD ["npm", "run", "start"]
