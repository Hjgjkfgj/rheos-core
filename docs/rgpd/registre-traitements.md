# Rhéos — Registre des traitements (RGPD art. 30)

> **DRAFT technique — à valider par le DPO / juriste.** Ce registre est **généré à partir
> du modèle de données réel** (`src/types.ts`, `prisma/schema.prisma`) et des mécanismes
> effectivement implémentés (chiffrement, RLS, audit, rétention). Chaque qualification
> juridique (finalité précise, **base légale**, **durée**, destinataires) est marquée
> **⚖️ à valider**. Rhéos agit généralement en **sous-traitant** (art. 28) pour le compte
> de l'entreprise cliente, **responsable de traitement**.

- **Éditeur / sous-traitant** : Rhéos *(raison sociale, SIREN — ⚖️ à compléter)*.
- **Hébergeur (sous-traitant ultérieur)** : **Scaleway SAS**, région **fr-par** (Paris, France, UE).
- **DPO** : dpo@rheos-corp.fr *(⚖️ à confirmer)*.
- **Transferts hors UE** : **aucun identifié** (hébergement France). ⚖️ à confirmer si ajout de sous-traitants.

## Mesures de sécurité **réelles** (communes à tous les traitements)
| Mesure | Implémentation |
|---|---|
| Chiffrement au repos des données sensibles | AES-256-GCM (`src/crypto.ts`) — IBAN, NIR |
| Isolation multi-tenant | **Row-Level Security** PostgreSQL (`prisma/migrations/*/rls.sql`) ; rôle applicatif non-superutilisateur, `NOBYPASSRLS` |
| Chiffrement en transit | HTTPS/TLS obligatoire, redirection + **HSTS** (`src/app.ts`) |
| Journalisation | Journal d'audit métier (`AuditLog`) ; accès sensibles tracés (`SENSITIVE_PERMS`) ; événements de domaine append-only |
| Sauvegardes | `pg_dump` chiffré **AES-256** vers bucket, **restauration testée** |
| Gestion des secrets | Secret Manager (hors code/registry) ; clé de chiffrement `ENCRYPTION_KEY` externalisée |
| Contrôle d'accès | RBAC (permissions atomiques) + ABAC (périmètres) ; *deny by default* |

## Traitements par catégorie de données

### 1. Identité & coordonnées
- **Données** (`Person`, `Address`) : nom, prénom, nom d'usage, date de naissance, email personnel, adresses (historisées SCD-2).
- **Finalité** : gestion administrative du personnel. ⚖️ à valider
- **Base légale (probable)** : exécution du contrat de travail ; obligation légale (registre du personnel). ⚖️ à valider
- **Personnes concernées** : collaborateurs de l'entreprise cliente.
- **Destinataires** : service RH habilité (client) ; hébergeur Scaleway.
- **Durée** : durée de la relation + archivage légal. ⚖️ à valider (durée post-départ exacte).
- **Sécurité** : RLS, TLS, audit.

### 2. Données sensibles / à risque (NIR, coordonnées bancaires)
- **Données** (`SensitiveIdentifier`, `BankAccount`) : NIR, pièces d'identité (type), **IBAN** (chiffré ; seuls les 4 derniers en clair).
- **Finalité** : paie, déclarations sociales (DSN), virement des rémunérations. ⚖️ à valider
- **Base légale (probable)** : obligation légale (sociale/fiscale). ⚖️ à valider
- **Destinataires** : RH/paie habilités ; organismes sociaux (via l'outil de paie partenaire — hors périmètre Rhéos) ; hébergeur Scaleway.
- **Durée** : selon obligations sociales. ⚖️ à valider
- **Sécurité** : **chiffrement AES-256-GCM au repos** ; lecture en clair **habilitée + auditée** ; jamais réexposé par l'export « droit d'accès ».
- **Particularité NIR** : donnée encadrée (décret NIR) → ⚖️ **DPO** : vérifier le fondement du traitement du NIR.

### 3. Temps de travail & absences
- **Données** (`Shift`, `TimeEntry`, `LeaveRequest`, `LeaveLedgerEntry`) : plannings, pointages, congés, grand livre des congés (append-only).
- **Finalité** : suivi du temps de travail, gestion des congés, préparation de la paie. ⚖️ à valider
- **Base légale (probable)** : obligation légale (durée du travail) ; intérêt légitime (organisation). ⚖️ à valider
- **Destinataires** : manager, RH habilités ; hébergeur Scaleway.
- **Durée** : ⚖️ à valider (généralement plusieurs années).
- **Sécurité** : RLS, audit.

### 4. Carrière, compétences, contrats
- **Données** (`Employment`, `Contract`, `ContractAmendment`, `Assignment`, `Competency`, `Training`, `CareerReview`) : contrats, avenants, affectations, compétences/habilitations, formations, entretiens.
- **Finalité** : gestion de la relation de travail et des carrières. ⚖️ à valider
- **Base légale (probable)** : exécution du contrat ; obligation légale (formation) ; intérêt légitime. ⚖️ à valider
- **Destinataires** : RH, manager habilités ; hébergeur Scaleway.
- **Durée** : durée de la relation + rétention documentaire (voir §6). ⚖️ à valider

### 5. Documents (coffre-fort probant)
- **Données** (`Doc`) : contrats signés, bulletins, certificats, pièces (métadonnées + empreinte SHA-256 ; **le contenu n'est pas stocké dans la base** — `storageRef`).
- **Finalité** : conservation probante, mise à disposition du collaborateur. ⚖️ à valider
- **Base légale (probable)** : obligation légale ; intérêt légitime (preuve). ⚖️ à valider
- **Durée** : **politique de rétention datée par type** (`src/domain/retention.ts`) — bulletins 50 ans, contrats 5 ans post-relation, etc. ⚖️ à valider (voir `docs/gaps.md §1`). **Legal hold** = suspension de toute suppression.
- **Sécurité** : scellé SHA-256 (WORM) ; RLS ; cycle DRAFT/…/ARCHIVED ; suppression contrôlée (rétention échue + pas de legal hold).

### 6. Journaux & traçabilité
- **Données** (`AuditLog`, `DomainEvent`, `AiAuditLog`) : qui/quand/quoi (audit), événements de domaine (append-only), interactions IA (données utilisées, version — l'IA n'écrit jamais).
- **Finalité** : sécurité, traçabilité, imputabilité. ⚖️ à valider
- **Base légale (probable)** : intérêt légitime / obligation de sécurité. ⚖️ à valider
- **Durée** : ⚖️ à valider (proportionnalité des logs).

## Exercice des droits (voir `docs/rgpd/droits-des-personnes.md`)
- **Droit d'accès (art. 15)** : export complet PDF + JSON, journalisé, sur habilitation RH — `GET /api/v1/persons/:id/access-request`.
- **Effacement / anonymisation (art. 17)** : `POST /api/v1/persons/:id/anonymize` (ou `npm run anonymize`) en fin de rétention.
- **Rectification** : demandes de changement self-service validées par le RH (`ChangeRequest`).
- **Portabilité (art. 20)** : export CSV/JSON (Lot 16).

## Questions ouvertes pour le DPO/juriste
1. Bases légales exactes par catégorie (contrat vs obligation légale vs intérêt légitime).
2. Durées de conservation précises (et point de départ) par donnée — cf. `gaps.md`.
3. Fondement spécifique du traitement du **NIR**.
4. Répartition responsable/sous-traitant selon les modules (certaines analyses RH pourraient faire de Rhéos un responsable conjoint ?).
5. Information des personnes (mention au contrat de travail / note interne du client).
