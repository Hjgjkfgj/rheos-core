#!/usr/bin/env bash
# Passage en base réelle — 100% via Docker (aucun psql requis sur la machine).
# Prérequis : Docker Desktop lancé, et `npm run db:up` déjà exécuté.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker introuvable. Installe Docker Desktop puis relance." >&2
  exit 1
fi

ADMIN_URL="${DATABASE_URL_ADMIN:-postgresql://postgres:postgres@localhost:5432/rheos?schema=public}"
DC="docker compose"
PSQL="$DC exec -T db psql -U postgres -d rheos -v ON_ERROR_STOP=1"

echo "→ Attente de PostgreSQL (conteneur)…"
for i in $(seq 1 30); do
  if $DC exec -T db pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done

echo "→ Rôle applicatif rheos_app (non-superutilisateur)"
$PSQL -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rheos_app') THEN CREATE ROLE rheos_app LOGIN PASSWORD 'rheos_app'; END IF; END \$\$;"

echo "→ Génération du client Prisma + push du schéma (URL admin)"
DATABASE_URL="$ADMIN_URL" npx prisma generate
DATABASE_URL="$ADMIN_URL" npx prisma db push --skip-generate

echo "→ Droits pour rheos_app"
$PSQL -c "GRANT USAGE ON SCHEMA public TO rheos_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rheos_app;
          ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rheos_app;"

echo "→ Application de la Row-Level Security"
$PSQL < prisma/migrations/0001_init/rls.sql

echo "✅ Base prête. Lance : STORE=prisma npm start   (puis http://localhost:3000)"
