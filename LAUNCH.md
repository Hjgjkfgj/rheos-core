# Rhéos — Démarrage rapide

## En 3 commandes (mode mémoire — aucune base requise)

```bash
npm install
npm test           # 180+ tests verts (STORE=memory)
npm start          # API + espace collaborateur sur http://localhost:3000
```

- Console de contrôle (démo) : http://localhost:3000/
- **Espace collaborateur (PWA installable)** : http://localhost:3000/espace
- Santé : http://localhost:3000/health

## Peupler des données de démonstration (multi-secteurs)

```bash
npm run seed       # boulangerie (8), restaurant (38, 3 établissements), PME (60, 2 sites)
```

## Mode PostgreSQL + Row-Level Security (production)

```bash
npm run db:up                                   # Postgres via Docker (docker-compose.yml)
DATABASE_URL="$DATABASE_URL_ADMIN" npx prisma db push   # schéma (rôle admin)
psql "$DATABASE_URL_ADMIN" -f prisma/migrations/0001_init/rls.sql   # active la RLS (+ migrations 0002..0006)
STORE=prisma JWT_SECRET="<secret-fort>" npm start
```

L'application se connecte avec le rôle **non-superutilisateur** `rheos_app`
(`DATABASE_URL`) pour que la RLS s'applique réellement ; le rôle admin
(`DATABASE_URL_ADMIN`) ne sert qu'à créer le schéma et les policies.

## Qualité (identique à la CI)

```bash
npm run lint:vocab     # glossaire Tome 01 + anglais du code (ADR-002)
npm run typecheck      # TypeScript strict (nécessite `npx prisma generate`)
STORE=memory npm test  # suite complète, dont l'acceptation Gherkin d1-d2
```

## Sauvegarde / restauration

- **Mémoire** : `repo.dump()` / `repo.load(snapshot)` (round-trip testé, `test/security.test.ts`).
- **PostgreSQL** : `pg_dump` / `pg_restore` standards (la base est la source de vérité).

## Variables d'environnement (`.env.example`)

| Variable | Rôle |
|---|---|
| `STORE` | `memory` (défaut) ou `prisma` |
| `DATABASE_URL` | rôle applicatif `rheos_app` (RLS active) |
| `DATABASE_URL_ADMIN` | rôle admin (schéma + policies uniquement) |
| `JWT_SECRET` | secret de signature JWT (obligatoire et fort en production) |
| `PORT` | port d'écoute (défaut 3000) |
