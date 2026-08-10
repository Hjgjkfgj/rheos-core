# Rhéos — Runbook staging (Scaleway, fr-par)

Projet `rheos-staging`. App = Serverless Container ; base = Managed PostgreSQL
`rheos-staging-db` (DEV-S, PITR 7 j) ; sauvegardes = bucket `rheos-backups-staging` ;
secrets = Secret Manager. **Aucun secret en clair** : tout vient de Secret Manager
(app) ou des GitHub Secrets (CI). URL cible : https://staging.rheos-corp.fr

## 0. Secrets & variables

**Secret Manager (Scaleway)** → injectés dans le container :
| Nom | Contenu |
|---|---|
| `jwt-secret` | secret JWT fort (≥ 32 c.) → `JWT_SECRET` |
| `encryption-key` | clé de chiffrement IBAN/NIR → `ENCRYPTION_KEY` |
| `database-url` | `postgresql://rheos_app:***@HOST:PORT/rheos?sslmode=require&connection_limit=5` → `DATABASE_URL` |
| `backup-encryption-key` | passphrase de chiffrement des dumps → `BACKUP_ENCRYPTION_KEY` |

**GitHub Secrets** (CI/CD) : `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`, `SCW_DEFAULT_PROJECT_ID`,
`SCW_DEFAULT_ORGANIZATION_ID`, `SCW_CONTAINER_ID`, `DATABASE_URL_ADMIN`.
**GitHub Variables** : `SCW_REGISTRY` (`rg.fr-par.scw.cloud/rheos-staging`), `STAGING_URL`.

L'app tourne avec **`rheos_app`** (non-superutilisateur, `NOBYPASSRLS`, DML seul) en
**connexion directe TLS** (`sslmode=require`). Les **migrations** tournent avec
**l'utilisateur admin** (DDL) — jamais l'app.

## 1. Déploiement initial (une fois — console/CLI, tu exécutes)

```bash
# Auth CLI (une fois) — ou utilise la console
scw init  # colle SCW_ACCESS_KEY / SCW_SECRET_KEY / project / org

# a) Namespace de registry
scw registry namespace create name=rheos-staging region=fr-par

# b) Build + push de la première image (nécessite Docker en local)
docker build -t rg.fr-par.scw.cloud/rheos-staging/rheos-core:bootstrap .
echo "$SCW_SECRET_KEY" | docker login rg.fr-par.scw.cloud -u nologin --password-stdin
docker push rg.fr-par.scw.cloud/rheos-staging/rheos-core:bootstrap

# c) Schéma + RLS + privilèges (avec l'URL ADMIN)
DATABASE_URL="$ADMIN_URL" npx prisma db push --skip-generate
for f in prisma/migrations/*/rls.sql; do psql "${ADMIN_URL%%\?*}" -f "$f"; done
psql "${ADMIN_URL%%\?*}" -f prisma/staging/rheos-app-grants.sql

# d) Créer le Serverless Container (min-scale 1 = pas de cold start, max 2, port 3000)
scw container namespace create name=rheos-staging region=fr-par
scw container container create name=rheos-core region=fr-par \
  namespace-id=<NS_ID> registry-image=rg.fr-par.scw.cloud/rheos-staging/rheos-core:bootstrap \
  port=3000 min-scale=1 max-scale=2 memory-limit=512 \
  environment-variables.NODE_ENV=production environment-variables.STORE=prisma
# Les SECRETS (JWT_SECRET, ENCRYPTION_KEY, DATABASE_URL, BACKUP_ENCRYPTION_KEY) :
# console → Container → « Variables d'environnement » → « Ajouter depuis Secret Manager »
# (référence chaque secret ; ne JAMAIS coller la valeur en clair).
scw container container deploy <CONTAINER_ID> region=fr-par
# Récupère SCW_CONTAINER_ID (→ GitHub Secret) et le domaine auto :
scw container container get <CONTAINER_ID> region=fr-par -o json | grep -i domain_name
```

### Domaine custom `staging.rheos-corp.fr`
1. Chez ton DNS (rheos-corp.fr), crée un **CNAME** :
   `staging` → **`<le domain_name auto du container>`** (ex. `xxxxxxxx.functions.fnc.fr-par.scw.cloud.`) — je te confirme la valeur exacte dès que tu me colles la sortie de `scw container container get`.
2. Console Scaleway → Container → **Domaines** → *Ajouter* `staging.rheos-corp.fr` → **TLS automatique** (Let's Encrypt).
3. L'app force **HTTPS + HSTS** en production (`x-forwarded-proto`, `Strict-Transport-Security`) — rien à configurer côté app.

## 2. Pool de connexions — pourquoi pas (encore) de PgBouncer
- Prisma est limité à **`connection_limit=5`** par instance ; avec `max-scale=2` → **≤ 10**
  connexions applicatives, très en dessous de la limite d'une **DEV-S**.
- **`SET LOCAL app.tenant_id` par transaction** impose un pooling **transaction** ou
  **session** (jamais *statement*). PgBouncer *transaction mode* est compatible (le
  `SET LOCAL` reste dans la transaction), mais **inutile à cette échelle** et il
  ajoute une pièce à opérer/superviser.
- **Seuil de bascule vers PgBouncer** : quand `max-scale × connection_limit` s'approche
  de **~70 %** de `max_connections` de l'instance (montée en charge, plusieurs services,
  ou passage à une offre avec peu de connexions). À ce moment : PgBouncer **transaction
  mode**, en gardant `SET LOCAL` (compatible), et baisser `connection_limit` côté Prisma.

## 3. Redéploiement (automatique)
Merge sur `main` → workflow **`.github/workflows/deploy-staging.yml`** :
`tests → build image → push registry → migrations (URL admin) → deploy container → smoke /health`.
Redéploiement manuel : `scw container container deploy $SCW_CONTAINER_ID region=fr-par`.

## 4. Sauvegardes & restauration
- **Sauvegarde quotidienne** : workflow `.github/workflows/backup-staging.yml` (cron) →
  `scripts/backup.sh` (`pg_dump | gzip | openssl AES-256 | bucket`). Chiffré au repos ;
  round-trip prouvé (`scripts/` — voir aussi le test local du lot).
- **Restauration (base JETABLE)** :
  ```bash
  # créer une base jetable (console) puis :
  RESTORE_TARGET_URL="<admin url base jetable>" BACKUP_KEY="rheos-staging-....sql.gz.enc" \
  BACKUP_ENCRYPTION_KEY="<clé>" BACKUP_BUCKET=rheos-backups-staging \
  S3_ENDPOINT=https://s3.fr-par.scw.cloud AWS_ACCESS_KEY_ID=$SCW_ACCESS_KEY \
  AWS_SECRET_ACCESS_KEY=$SCW_SECRET_KEY bash scripts/restore.sh
  psql "<admin url jetable>" -c 'SELECT count(*) FROM "LegalEntity";'   # preuve
  ```
- **PITR natif (console)** : Managed DB → `rheos-staging-db` → **Sauvegardes / PITR** →
  choisir un instant (≤ 7 j) → *Restaurer* vers une **nouvelle** instance → valider →
  basculer `DATABASE_URL`/`DATABASE_URL_ADMIN` si adoption.

## 5. Rotation des secrets
- **`JWT_SECRET`** : nouveau secret dans Secret Manager → redeploy → invalide les jetons émis.
- **`DATABASE_URL`** (mot de passe `rheos_app`) : changer le mot de passe (console DB) →
  MAJ du secret → redeploy.
- **`ENCRYPTION_KEY`** (⚠️ re-chiffrement obligatoire) :
  ```bash
  OLD_ENCRYPTION_KEY="<ancienne>" ENCRYPTION_KEY="<nouvelle>" \
  DATABASE_URL_ADMIN="<admin>" node scripts/reencrypt.mjs --dry   # simulation
  # puis sans --dry ; ENSUITE mettre à jour le secret encryption-key + redeploy
  ```
- **`backup-encryption-key`** : garder l'ancienne clé tant que d'anciens dumps existent
  (sinon ils deviennent illisibles) ; documenter la date de bascule.

## 6. Supervision
- **`/health`** : `{status, store, db, ts}` ; renvoie **503** si la base est injoignable
  (le HEALTHCHECK du container et le smoke test s'en servent).
- **Uptime externe (gratuit)** : **UptimeRobot** → *Add monitor* type **HTTPS**,
  URL `https://staging.rheos-corp.fr/health`, intervalle **5 min**, *Keyword* = `"db":true`,
  alerte e-mail. (Alternative : Better Uptime free.)
- **Logs du container** : console → Container → **Logs** (Cockpit), ou
  `scw container container logs $SCW_CONTAINER_ID region=fr-par`.

## 7. Seed de démonstration sur staging
```bash
STORE=prisma DATABASE_URL="postgresql://rheos_app:***@HOST:PORT/rheos?sslmode=require&connection_limit=5" \
  npm run seed
# → boulangerie (8), restaurant (38, 3 étab.), PME (60) dans le tenant DEMO.
```

## 8. Diagnostiquer une panne
1. `curl -s https://staging.rheos-corp.fr/health` → `db:false` ⇒ base injoignable
   (vérifier `DATABASE_URL`, TLS, état de l'instance DB).
2. Logs container (§6) : erreur au démarrage ? `Refus de démarrage : … CONTOURNE la RLS`
   ⇒ l'app est branchée sur un rôle superuser/bypassrls → corriger `DATABASE_URL` (→ rheos_app).
3. Déploiement KO : relancer le workflow, vérifier le job `migrate` (URL admin) et `smoke`.
4. RLS : `node scripts/rls-check.mjs` (isolation) ; test négatif via `THROWAWAY_ADMIN_URL`.
5. Restauration de secours : PITR (§4) ou dernier dump chiffré (§4).
