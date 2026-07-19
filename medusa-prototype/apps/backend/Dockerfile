FROM node:22.14.0-bookworm-slim AS builder

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm config set maxsockets 5 \
  && npm ci --no-audit --no-fund

COPY apps/backend apps/backend
RUN npm --workspace @dtc/backend run build

FROM node:22.14.0-bookworm-slim AS runner

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder /workspace/apps/backend/.medusa/server ./
RUN npm install --omit=dev --no-audit --no-fund \
  && npm cache clean --force

EXPOSE 9000

CMD ["sh", "-c", "npx medusa db:migrate && npm run start"]
