FROM node:20-alpine AS builder
WORKDIR /repo

# Copy workspace manifests
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY cre/package.json ./cre/

# Install all workspace dependencies
RUN npm ci

# Copy source and build
COPY cre ./cre
RUN cd cre && npm run build

# ── Runtime ──────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/cre/dist ./dist
COPY --from=builder /repo/cre/package.json ./package.json

EXPOSE 3002

CMD ["node", "dist/server.js"]
