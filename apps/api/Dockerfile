FROM node:20-alpine AS builder
WORKDIR /repo

# Copy workspace manifests (needed for npm workspaces to resolve correctly)
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY cre/package.json ./cre/

# Install all workspace dependencies
RUN npm ci

# Copy Prisma schema and generate client
COPY apps/api/prisma ./apps/api/prisma
RUN cd apps/api && npx prisma generate

# Copy source and build
COPY apps/api ./apps/api
RUN cd apps/api && npm run build

# ── Runtime ──────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Copy only what's needed to run
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/api/prisma ./prisma
COPY --from=builder /repo/apps/api/package.json ./package.json

EXPOSE 3001

# Run migrations then start the API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
