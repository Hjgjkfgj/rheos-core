# Rhéos — README par domaine (MVP P1+P2)

Architecture : objets métier reliés par un port `Repository` (ADR-014, deux
implémentations mémoire/Prisma), un event bus append-only, et des moteurs
déterministes. Autorisation = tenant (RLS) ∧ RBAC ∧ ABAC. UI/doc en français,
code/API en anglais (ADR-002).

## D1 — Entreprise & Référentiel
- **Objets** : Group, LegalEntity, Establishment, OperatingSite, OrgUnit, Position, Agreement, WorkforceSnapshot, Obligation.
- **Code** : `services.ts` (D1), `domain/thresholds.ts` (seuils datés), `domain/convention.ts` (convention datée).
- **Capacités** : onboarding entreprise (SIREN contrôlé, doublon), établissements (fermeture CLOSED + historique, jamais de suppression), convention datée (`AgreementLinked`), moteur d'effectif + obligations idempotentes, cycle obligation DETECTED→…→ARCHIVED, simulation « et si j'embauche N ? ».
- **Tests** : `acceptance/d1.test.ts`, `d1-referential.test.ts`, `thresholds.test.ts`, `engines.test.ts`.

## D2 — Dossier collaborateur
- **Objets** : Person, Employment, Contract, ContractAmendment, Assignment, HrEvent, Document.
- **Code** : `services.ts` (D2), `services-me.ts` (self-service).
- **Capacités** : embauche en cascade, séparation création/validation/signature, avenants (historique conservé), départ (clôture affectations, EXITING→ENDED→ARCHIVED, réembauche = nouvel Employment), Employee 360 `?asOf=`, RUP dynamique par établissement.
- **Tests** : `acceptance/d2.test.ts`, `d2-dossier.test.ts`, `temporal-and-registry.test.ts`, `hire-and-contract.test.ts`.

## Socle Temps (D3) — absences, congés, compteurs
- **Objets** : LeaveRequest, LeaveLedgerEntry (append-only), Shift, TimeEntry.
- **Code** : `domain/leave.ts` (config datée : types, acquisition, calendrier fériés, décompte ouvrables), `services-mvp.ts` (workflow), `services-time.ts` (planning/pointage).
- **Capacités** : demande→manager→(RH)→APPROVED, décompte ouvrables hors fériés/fermetures, soldes via ledger (recalcul passé), corrections append-only, `LeaveApproved` consommé par planning + préparation paie.
- **Spec** : `docs/spec-absences.md` (validée). **Tests** : `leave-socle.test.ts`, `time.test.ts`.

## D10 — Coffre-fort & documents
- **Objets** : Document (14 métadonnées, statuts DRAFT→…→ARCHIVED), RetentionPolicy, SignatureProvider.
- **Code** : `services-mvp.ts` (D10), `signature.ts` (interface + OTP eIDAS-ready), `domain/retention.ts`, `domain/templates.ts`.
- **Capacités** : dépôt scellé SHA-256 (WORM, contenu jamais stocké), intégrité vérifiable, signature OTP + certificat de preuve, legal hold bloquant, DELETE/ANONYMIZE/ARCHIVE distincts, templates avec contrôle de données requises, archivage auto au départ, admin technique sans accès contenu.
- **Tests** : `d10-vault.test.ts`, `vault.test.ts`.

## IA cadrée (R0-R2, ADR-010)
- **Code** : `domain/extraction.ts` (R1), `services-rh-officer.ts` (briefing R2 déterministe), `services-assistant.ts` (assistant R2 lecture seule).
- **Capacités** : extraction (type + confiance + REQUIRES_REVIEW, jamais validation), briefing déterministe reformulable par un LLM sans altérer les faits, assistant scopé aux données autorisées (permission avant contexte), refus explicite, anti prompt-injection, journalisation `AiAuditLog`, aucune écriture IA.
- **Tests** : `ai-cadree.test.ts`, `extraction.test.ts`, `rh-officer.test.ts`.

## Transverse
- **Sécurité** : `auth.ts` (RBAC atomique + ABAC scopes), `security.ts` (en-têtes + rate limiting), `jwt.ts` (HS256). Tests : `rbac-abac.test.ts`, `security.test.ts`, `tenant-isolation*.test.ts`, `auth.test.ts`.
- **Espace collaborateur PWA** : `web/espace.html` + `manifest.webmanifest` + `sw.js`. Tests : `front.test.ts`.
- **Persistance** : `repository.ts` (mémoire + dump/load), `prisma-repository.ts` (RLS `SET LOCAL app.tenant_id`).

Voir aussi : `docs/DoD-report.md`, `docs/gaps.md`, `docs/event-catalog.md`, `docs/convergence-report.md`, `LAUNCH.md`.
