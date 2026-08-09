# Rhéos — Rapport final Definition of Done (MVP P1+P2) — v0.2.0-mvp

**Statut : DoD 100 % VERTE** (hors hypothèses juridiques ouvertes, cf. `docs/gaps.md`).
Preuves : **193 tests** (188 mémoire + 5 Prisma) verts ; typecheck strict vert ;
`lint:vocab` vert ; CI **4 jobs verts** (lint · test-memory · typecheck · prisma-rls),
job Prisma en base réelle PostgreSQL 16 + RLS.

> Run CI : https://github.com/Hjgjkfgj/rheos-core/actions (branche `main` + tag `v0.2.0-mvp`).

## Résumé exécutif
Le MVP est fonctionnellement complet et prouvé de bout en bout, **dans les deux
stores** (mémoire et PostgreSQL+RLS) :
- **D1** Entreprise & Référentiel · **D2** Dossier collaborateur · **D2b** données
  sensibles (NIR/IBAN chiffrés, lecture auditée) + change requests · **D10** coffre-fort
  WORM · **Socle Temps** (congés/ledger) · **PWA collaborateur installable** · **IA cadrée** (R0-R2).
- Sécurité : RBAC atomique + ABAC, isolation multi-tenant **prouvée** (et test négatif
  « sans RLS l'isolation tombe »), deny-by-default, scénarios d'attaque testés.
- Invariants respectés (Person≠Employment, temporalité `?asOf=`, append-only, aucune
  règle légale en dur, IA lecture seule human-in-the-loop, vocabulaire officiel).
- Specs `rheos-specs-d1-d2/` alignées et versionnées (Lot 12) ; cohérence sans écart.

## DoD globale du prompt maître — point par point (preuve concrète)

| # | Critère DoD | État | Preuve (test) | Job CI |
|---|---|---|---|---|
| 1 | Cycle **embauche → contrat signé → dossier → RUP → coffre-fort**, droits + audit | ✅ | `test/acceptance/full-cycle.test.ts` | test-memory, prisma-rls |
| 2 | Tous les **scénarios Gherkin d1-d2** passent en CI | ✅ | D1 `acceptance/d1.test.ts` (Sc.1-4) · D2 `acceptance/d2.test.ts` (Sc.6-13) · isolation `tenant-isolation.test.ts` (Sc.5) · sensibles `acceptance/d2b-sensitive.test.ts` (Sc.14-15) | test-memory **et** prisma-rls |
| 3 | **`STORE=prisma` + RLS ≡ `STORE=memory`** sur toute la suite | ✅ | acceptations exécutées sur Prisma via `buildDB()` ; `test/prisma-rls.test.ts` | **prisma-rls** (PostgreSQL 16) |
| 4 | Un test prouve l'**isolation inter-tenant** (+ échoue sans RLS) | ✅ | `tenant-isolation.test.ts`, `tenant-isolation-search.test.ts`, `prisma-rls.test.ts` (test NÉGATIF « sans RLS, l'isolation tombe ») | test-memory, prisma-rls |
| 5 | Chaque endpoint **authentifié/autorisé** ; **données sensibles journalisées** | ✅ | deny-by-default `security.test.ts` ; lecture IBAN/NIR auditée `acceptance/d2b-sensitive.test.ts` (Sc.15) ; IA journalisée `ai-cadree.test.ts` | test-memory, prisma-rls |
| 6 | **Espace collaborateur PWA** sur mobile (installable) | ✅ | `front.test.ts` (manifest + SW + **icônes PNG 192/512** + maskable) ; installabilité `docs/pwa-lighthouse.md` | test-memory |
| 7 | **Aucune règle légale codée en dur** | ✅ | seuils datés `domain/thresholds.ts`, rétention `domain/retention.ts`, congés `domain/leave.ts` ; `lint:vocab` vert | lint, test-memory |
| 8 | **Documentation à jour** (OpenAPI, événements, README) | ✅ | specs v1.1.0 alignées + `docs/coherence-report.md` (**zéro écart in-scope**), `event-catalog.md`, `README-domains.md`, `LAUNCH.md` | lint |

**Aucun ⏳ ni ⚠️** hors les hypothèses juridiques de `docs/gaps.md` (rétention, seuils,
RUP, eIDAS, congés — **volontairement ouvertes**, à valider par un juriste).

## Invariants non négociables — vérification
- **Person ≠ Employment** (ADR-003) ✅ `d2-dossier.test.ts` (réembauche = nouvel Employment).
- **Multi-tenant + RLS** (ADR-006) ✅ mémoire + **RLS réelle en CI** ; `tenantId` du JWT signé.
- **Temporalité** (ADR-004) ✅ `employee360?asOf=`, ledger congés rejouable, événements append-only.
- **Rien n'est écrasé** ✅ avenants/corrections/archivage ; DELETE contrôlé (rétention + legal hold).
- **Projections** (RUP, Employee 360) ✅ jamais de base parallèle.
- **tenant ∧ RBAC ∧ ABAC**, deny by default ✅ `rbac-abac.test.ts`, `security.test.ts`.
- **Créer ≠ valider ≠ signer** ✅ contrats/avenants/documents.
- **IA propose, l'humain dispose** (ADR-010) ✅ `ai-cadree.test.ts` (lecture seule, journalisée, anti-injection).
- **Langage** (ADR-002) ✅ `lint:vocab` vert.

## Durcissement & sécurité
En-têtes + rate limiting (`security.ts`), garde-fou secret + **refus superutilisateur en
prod** (`db-guard.ts`), dépendances minimales, scénarios d'attaque (JWT falsifié/expiré,
élévation RBAC, cross-tenant, IDOR) — `security.test.ts`, `prisma-rls.test.ts`.

## Réserves (hors DoD)
- **Hypothèses juridiques** ouvertes (`docs/gaps.md` §1-5) — par conception.
- **Lighthouse** non exécuté dans l'environnement de build (pas de Chrome headless CLI) ;
  toutes les conditions d'installabilité sont réunies et testées, **procédure d'exécution
  documentée** (`docs/pwa-lighthouse.md`).
- Le paquet `rheos-specs-d1-d2/` vit hors du dépôt git `rheos-core` (versionné par note d'en-tête).
