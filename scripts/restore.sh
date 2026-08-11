#!/usr/bin/env bash
# Rhéos — restauration d'une sauvegarde chiffrée sur une base CIBLE (Lot 15).
# ⚠️ Restaurer sur une base JETABLE (ex. rheos-restore-test), jamais sur staging en place.
# Variables :
#   RESTORE_TARGET_URL     URL admin de la base cible (jetable)
#   BACKUP_ENCRYPTION_KEY  passphrase (même que backup.sh)
#   BACKUP_BUCKET / S3_ENDPOINT / AWS_* (cf. backup.sh)
#   BACKUP_KEY             nom de l'objet, ex. rheos-staging-20260809T....sql.gz.enc
set -euo pipefail
: "${RESTORE_TARGET_URL:?}" "${BACKUP_ENCRYPTION_KEY:?}" "${BACKUP_BUCKET:?}" "${S3_ENDPOINT:?}" "${BACKUP_KEY:?}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

aws s3 cp "s3://${BACKUP_BUCKET}/db/${BACKUP_KEY}" "${TMP}/b.enc" --endpoint-url "${S3_ENDPOINT}"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "env:BACKUP_ENCRYPTION_KEY" -in "${TMP}/b.enc" \
  | gunzip \
  | psql "$RESTORE_TARGET_URL"
echo "✓ Restauration terminée sur la base cible."
echo "  Vérifier ensuite : psql \"$RESTORE_TARGET_URL\" -c 'SELECT count(*) FROM \"LegalEntity\";'"
