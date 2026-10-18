FROM node:22.14.0-bookworm-slim AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm config set maxsockets 5 \
  && npm ci --no-audit --no-fund

COPY apps/backend apps/backend
RUN npm --workspace @dtc/backend run build

# The generated server package is an independent npm root. Preserve the
# security overrides there and lock the production install before copying it.
RUN node -e 'const fs = require("node:fs"); const path = "apps/backend/.medusa/server/package.json"; const pkg = JSON.parse(fs.readFileSync(path, "utf8")); pkg.overrides = require("./package.json").overrides; fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n");' \
  && npm --prefix apps/backend/.medusa/server install \
    --package-lock-only --ignore-scripts --workspaces=false --no-audit --no-fund

FROM node:22.14.0-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY apps/backend/certificates/ /usr/local/share/ca-certificates/
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt

COPY --from=builder /workspace/apps/backend/.medusa/server ./
RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && chown -R node:node /app

# Процесс не должен быть root: на этом хосте контейнер работает в
# `network_mode: host` и рядом лежат `.env.production` с секретами и каталог с
# дампами БД. RCE в приложении не обязана сразу становиться root на машине.
USER node

EXPOSE 9000

# Без healthcheck зависший процесс не отличим от живого: Caddy продолжает
# проксировать в мёртвый upstream, а `restart: unless-stopped` не срабатывает,
# потому что контейнер формально запущен. Node 22 умеет fetch, поэтому curl в
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
