# Rhéos — Contrôle de cohérence specs ↔ code (Lot 12)

Date : 2026-08-09. Périmètre du paquet normatif : **D1 + D2 (+ D10)**. Les domaines
**D3 (Temps)** et **D5-D9** sont hors de ce paquet (voir `domain-d3-temps.md` et
`docs/README-domains.md`). Diffs générés programmatiquement (routes app.ts,
événements émis, seed `auth.ts`) contre les fichiers normatifs.

## 1. OpenAPI ↔ routes réelles (in-scope D1/D2/D10)
- **Documenté non implémenté** : `GET /employments/{id}` → **corrigé** (implémenté + test `test/employment-detail.test.ts`).
- **Implémenté non documenté** : `GET /companies/{id}/workforce`, `POST …/workforce/simulate`, `GET /companies/{id}/obligations`, `GET /contracts/{id}/amendments`, `POST /amendments/{id}/sign`, `GET /persons/{id}/documents` → **ajoutés à l'OpenAPI** (v1.1.0).
- **Résultat : SANS ÉCART in-scope ✓.**
- Routes D3/D5-D9 (≈60) : hors périmètre du paquet, documentées (`domain-d3-temps.md`, `README-domains.md`).

## 2. Catalogue d'événements ↔ événements émis
- Événements in-scope désormais catalogués (section « Ajouts lots 2-11 ») :
  `ObligationStatusChanged`, `ContractValidated`, `AmendmentApplied`,
  `EmploymentArchived`, `SignatureRequested`, `DocumentSigned`,
  `DocumentValidated/Published/Archived/Anonymized/Deleted`, `LegalHoldPlaced/Released`,
  `ChangeRequestSubmitted/Approved/Refused`.
- **Résultat : SANS ÉCART in-scope ✓.**
- Événements D3/D5-D9 (`Leave*`, `Shift*`, CSE, `Budget*`, `Risk*`…) : hors périmètre, listés en note.

## 3. Matrice de permissions ↔ seed (`auth.ts`)
- Permissions in-scope ajoutées à `permissions.md` (§1.bis) : `obligation.manage`,
  `assignment.read`, `document.legal_hold`, `document.sign`, `document.sign.self`,
  `person.sensitive.write`, `change_request.submit`, `change_request.validate`.
- Rappel : `company.write` reste **TenantAdmin uniquement** (matrice §3) — le seed y est conforme (réconcilié L1).
- **Résultat : SANS ÉCART in-scope ✓.**
- Permissions transverses D3-D9 (`leave.*`, `planning.*`, `social.*`…) : hors périmètre, notées.

## 4. Schéma normatif
`schema.prisma` mis à jour (enums ARCHIVED×2, `DocumentStatus`, `ChangeRequestStatus` ;
modèles `AiAuditLog`, `ChangeRequest` ; colonnes `Document`, `AuditLog.reason` ;
correctif `UserRole`). **Validé** (`prisma validate` OK).

## Conclusion
**Zéro delta non arbitré** (décisions A appliquées) ; **contrôle de cohérence
in-scope sans écart**. Specs versionnées (note de version en tête de chaque fichier).
Les domaines D3/D5-D9 sont explicitement hors du paquet D1/D2 et documentés.

> Réserve structurelle : le paquet `rheos-specs-d1-d2/` vit **hors du dépôt git
> `rheos-core`** ; ses mises à jour sont versionnées par la note d'en-tête (date +
> résumé), pas par git de rheos-core.
