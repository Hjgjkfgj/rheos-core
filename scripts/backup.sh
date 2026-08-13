#!/usr/bin/env bash
# Rhéos — sauvegarde chiffrée vers Object Storage (Lot 15).
# pg_dump (admin) → gzip → openssl AES-256 (clé Secret Manager) → bucket S3-compat.
# Variables (depuis Secret Manager / secrets CI) :
#   DATABASE_URL_ADMIN     URL admin (dump complet)
#   BACKUP_ENCRYPTION_KEY  passphrase de chiffrement (Secret Manager, dédiée)
#   BACKUP_BUCKET          ex. rheos-backups-staging
#   S3_ENDPOINT            ex. https://s3.fr-par.scw.cloud
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY = SCW_ACCESS_KEY / SCW_SECRET_KEY
set -euo pipefail
: "${DATABASE_URL_ADMIN:?}" "${BACKUP_ENCRYPTION_KEY:?}" "${BACKUP_BUCKET:?}" "${S3_ENDPOINT:?}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="rheos-staging-${TS}.sql.gz.enc"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# Serveur Scaleway en PostgreSQL 17 → pg_dump DOIT être en v17. Sur le runner GitHub,
# `pg_dump` « nu » peut pointer sur la v16 pré-installée → on préfère le binaire versionné.
PG_DUMP=pg_dump
[ -x /usr/lib/postgresql/17/bin/pg_dump ] && PG_DUMP=/usr/lib/postgresql/17/bin/pg_dump

# Dump → gzip → chiffrement (jamais de clair sur disque au repos).
"$PG_DUMP" --no-owner --no-privileges "$DATABASE_URL_ADMIN" \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "env:BACKUP_ENCRYPTION_KEY" \
  > "${TMP}/${FILE}"

SIZE="$(du -h "${TMP}/${FILE}" | cut -f1)"
aws s3 cp "${TMP}/${FILE}" "s3://${BACKUP_BUCKET}/db/${FILE}" --endpoint-url "${S3_ENDPOINT}"
echo "✓ Sauvegarde chiffrée poussée (${SIZE}) : s3://${BACKUP_BUCKET}/db/${FILE}"
