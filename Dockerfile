# syntax=docker/dockerfile:1
# Rhéos — image de production (Lot 15). Multi-stage, node slim, utilisateur non-root,
# client Prisma généré au build, HEALTHCHECK sur /health. Runtime : tsx (ESM/TS).

# --- Stage build : dépendances + client Prisma -------------------------------
FROM node:20-slim AS builder
WORKDIR /app
ENV NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
# openssl requis par le moteur Prisma (détection de version) DÈS le build.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
# Le schéma doit être présent AVANT `npm ci` : le hook postinstall lance
# `prisma generate` pendant l'install → il lui faut prisma/schema.prisma.
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci                         # npm ci → postinstall → prisma generate (client généré au build)
COPY tsconfig.json ./
COPY src ./src
COPY web ./web

# --- Stage runtime : image finale --------------------------------------------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 STORE=prisma
# openssl requis par le moteur Prisma ; ca-certificates pour le TLS Postgres.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
# Utilisateur non-root.
RUN groupadd -g 10001 rheos && useradd -u 10001 -g rheos -m rheos
COPY --from=builder --chown=rheos:rheos /app/node_modules ./node_modules
COPY --from=builder --chown=rheos:rheos /app/package.json ./package.json
COPY --from=builder --chown=rheos:rheos /app/prisma ./prisma
COPY --from=builder --chown=rheos:rheos /app/tsconfig.json ./tsconfig.json
COPY --from=builder --chown=rheos:rheos /app/src ./src
COPY --from=builder --chown=rheos:rheos /app/web ./web
USER rheos
EXPOSE 3000
# HEALTHCHECK : fetch global (Node ≥ 18) ; 503 si la base est injoignable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(j=>process.exit(j.db?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "src/server.ts"]
