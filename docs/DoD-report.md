# Rhéos — Rapport final : Definition of Done (MVP P1+P2)

État : **180 tests verts** en `STORE=memory` (34 fichiers), `lint:vocab` **PASS**
(0 violation), `tsc` propre hors `prisma-repository.ts` (client Prisma non généré
dans cet environnement). Légende : ✅ vérifié ici · ⏳ prêt, vérifiable en CI/Postgres
(non exécutable dans le bac à sable) · ⚠️ partiel/reporté explicitement.

## 0. Mise à jour Lot 10 — Parité Postgres + RLS

**Typecheck complet VERT** (blocage `UserRole.@@id` levé, client Prisma généré,
`PrismaRepository` typé). La preuve d'exécution `STORE=prisma` se fait en **CI**
(pas de Postgres local) — job `prisma-rls`.

**Écarts memory/prisma identifiés et corrigés** (règle : PrismaRepository corrigé ;
services JAMAIS modifiés — ADR-014 respecté ; store mémoire non modifié car conforme) :

| Écart | Cause | Correctif | Emplacement |
|---|---|---|---|
| `prisma generate` cassé | `UserRole.@@id` réfère des champs nullables (P1012) | clé de substitution `id` + `@@unique` | `schema.prisma` |
| Dates : mémoire `"YYYY-MM-DD"`/ISO vs Prisma `Date` | type `DateTime` | `denorm` : `Date`→string (date-seule vs ISO) | `PrismaRepository` |
| Optionnels : mémoire `undefined` vs Prisma `null` | valeurs `null` | `denorm` : `null`→`undefined` | `PrismaRepository` |
| Décimaux : mémoire `number` vs Prisma `Decimal` | `@db.Decimal` | `denorm` : `Decimal`→`number` | `PrismaRepository` |
| `SET LOCAL` par interpolation de chaîne | injection potentielle | `set_config(..., is_local=true)` **paramétré** | `PrismaRepository.tx` |
| RLS incomplète (13 tables D5-D9) | policies manquantes | migration `0007_rls_complete` (39 tables) | `prisma/migrations` |
| Superutilisateur contourne la RLS | pas de garde-fou | `assertNonSuperuserInProd` au démarrage | `db-guard.ts` + `store-selector` |
| Tests inspectant le store mémoire (`app.db`) | non portables sur Prisma | réécrits via l'API (`employee360`) | `acceptance/d2` |
| `build()` par défaut mémoire | la suite n'exerçait pas Prisma | helper `buildDB()` store-aware + `resetDb()` | `test/helpers.ts` |

**Test négatif présent** : `test/prisma-rls.test.ts` prouve qu'AVEC la RLS le rôle
applicatif ne voit que son tenant, et que SANS RLS (rôle superutilisateur qui la
contourne) **l'isolation TOMBE** ; + refus de démarrage superutilisateur en prod ;
+ `set_config` posé par transaction. (S'exécute uniquement sous `STORE=prisma`.)

> Statut : **preuve d'exécution en attente du run CI vert** (lien à confirmer).
> Dès que `prisma-rls` est vert, la ligne #3 ci-dessous passe ⏳ → ✅.

## 1. DoD globale du prompt maître — point par point

| # | Critère DoD | État | Preuve / réserve |
|---|---|---|---|
| 1 | Cycle **embauche → contrat signé → dossier → RUP → coffre-fort** de bout en bout, avec droits et audit | ✅ | `test/acceptance/full-cycle.test.ts` (7 étapes, séparation validate/sign, RUP projeté, coffre scellé + intégrité, événements append-only) |
| 2 | Tous les scénarios **Gherkin d1-d2** passent en CI | ✅ / ⏳ | D1 (`acceptance/d1.test.ts`) + D2 6-13 (`acceptance/d2.test.ts`) **verts en mémoire** ; en `STORE=prisma` via `.github/workflows/ci.yml` (⏳ non exécuté ici : pas de Postgres). Scénarios 14-15 (bancaire sensible) **reportés** en D2b (voir ⚠️ #5) |
| 3 | **`STORE=prisma` + RLS ≡ `STORE=memory`** sur toute la suite | ⏳ | Job CI `prisma-rls` écrit (service Postgres, rôle `rheos_app`, application RLS, `STORE=prisma npm test`). **Non exécutable dans cet environnement** (aucun Postgres). Les deux stores partagent la même interface `Repository` (ADR-014) et les mêmes tests |
| 4 | Un test prouve l'**isolation inter-tenant** (lecture, recherche, export) | ✅ | `tenant-isolation.test.ts`, `tenant-isolation-search.test.ts` (get/list/**recherche**/scans), `security.test.ts` (cross-tenant → 404) |
| 5 | Chaque endpoint **authentifié/autorisé** ; **données sensibles journalisées** | ✅ / ⚠️ | Deny-by-default testé (`security.test.ts`) ; interactions **IA journalisées** (`AiAuditLog`). ⚠️ L'audit métier des **lectures NIR/IBAN** (`AuditLog`) reste à câbler avec les endpoints bancaires — **reporté en D2b** (scénario 15) |
| 6 | **Espace collaborateur PWA** sur mobile | ✅ | `front.test.ts` (manifest/SW/icône + parcours) + rendu mobile vérifié (375×812). Lighthouse : exigences d'installabilité réunies (non exécuté ici) |
| 7 | **Aucune règle légale codée en dur** | ✅ | Seuils (`domain/thresholds.ts` datés/versionnés), rétention (`RetentionPolicy`), congés (`domain/leave.ts` config datée) ; suppression de `DEFAULT_ALLOWANCE` ; `lint:vocab` PASS |
| 8 | **Documentation à jour** (OpenAPI, événements, README) | ✅ / ⚠️ | `docs/` : convergence-report, spec-absences, event-catalog, gaps, DoD-report ; README + LAUNCH (3 commandes). ⚠️ La **spec normative** `rheos-specs-d1-d2/` porte des **deltas non répercutés** (enums/events/openapi des lots 2-7) — listés §3, à appliquer sur validation |

## 2. Invariants non négociables — vérification

- **Person ≠ Employment** (ADR-003) ✅ — réembauche = nouvel Employment (`d2-dossier.test.ts`).
- **Multi-tenant + RLS** (ADR-006) ✅ mémoire ; ⏳ RLS réelle en CI. `tenantId` issu du JWT signé, jamais d'un paramètre.
- **Temporalité** (ADR-004) ✅ — `employee360?asOf=` (contrat/affectation/timeline datés), ledger congés rejouable, événements append-only.
- **Rien n'est écrasé** ✅ — avenants, corrections congés (ligne `CORRECTION`), obligations/documents archivés jamais supprimés (sauf DELETE contrôlé par rétention+legal hold).
- **Une seule source de vérité** ✅ — RUP et Employee 360 sont des **projections** dynamiques.
- **Autorisation tenant ∧ RBAC ∧ ABAC** (deny by default) ✅ — moteur `auth.ts`, matrice testée (`rbac-abac.test.ts`), scénarios d'attaque (`security.test.ts`).
- **Créer ≠ valider ≠ signer** ✅ — contrat (`contract.create`/`validate`/`sign`), avenants, documents.
- **IA propose, l'humain dispose** (ADR-010) ✅ — extraction ≠ validation, assistant lecture seule, aucune écriture IA, journalisation IA, anti prompt-injection (`ai-cadree.test.ts`).
- **Langage** (ADR-002) ✅ — code/API en anglais, UI/doc en français, `lint:vocab` PASS.
- **Événements** (ADR-005) ✅ — nommage `AggregatePastParticiple`, enveloppe commune, immuables.

## 3. Durcissement (Lot 8) livré

- **Sécurité** : en-têtes (`nosniff`, `SAMEORIGIN`, `no-referrer`, `permissions-policy`),
  **rate limiting** (anti-bruteforce auth, 429 testé), garde-fou **secret en production**
  (`server.ts`), **dépendances minimales** (fastify + @prisma/client, aucun framework
  lourd ajouté sur tout le MVP).
- **Scénarios d'attaque testés** : JWT falsifié (mauvais secret + rôle élevé → 401),
  JWT expiré → 401, élévation RBAC (collaborateur → 403), cross-tenant → 404,
  **IDOR documents** (signer le document d'un autre → 404).
- **Seed multi-secteurs** (`npm run seed`) : boulangerie (8), restaurant (38, 3 étab.),
  PME (60, 2 sites) — données synthétiques ; obligations déclenchées vérifiées.
- **Sauvegarde/restauration** : `dump()`/`load()` (round-trip testé) ; `pg_dump` pour Postgres.
- **CI** : `.github/workflows/ci.yml` — lint vocab, typecheck, tests mémoire **et**
  `STORE=prisma`+RLS.

## 4. Démonstration du cycle complet (trace `full-cycle.test.ts`)

```
1. POST /companies (TenantAdmin)                → LegalEntity + CompanyCreated
2. POST /companies/:id/establishments (HrMgr)   → Establishment + EstablishmentCreated
3. POST /employments (HrManager)                → Person + Employment(PRE_HIRE)
                                                  + Contract(DRAFT) + Assignment
                                                  + EmployeeHired/ContractCreated/EmployeeAssigned
4. POST /contracts/:id/validate (HrManager)     → VALIDATED + ContractValidated
   POST /contracts/:id/sign (HrManager)         → 403 (séparation des droits)
   POST /contracts/:id/sign (Signatory)         → SIGNED→ACTIVE + ContractSigned/ContractActivated
5. GET  /employments/:id/employee360            → dossier projeté (person, contrat ACTIVE, timeline)
6. GET  /companies/:id/registry                 → RUP dynamique (1 ligne cohérente)
7. POST /persons/:id/documents (HrManager)      → coffre scellé SHA-256 (WORM) + DocumentDeposited
   POST /documents/:id/verify                   → intégrité: authentique ✓ / altéré ✗
```

Tous les événements clés du cycle sont publiés (append-only), les droits sont
appliqués à chaque étape, et le coffre-fort est vérifiable.

## 5. Réserves honnêtes (non masquées)

1. **`STORE=prisma` + RLS non exécuté** dans cet environnement (aucun Postgres/Docker).
   Tout le code + la CI sont écrits ; la preuve se fera au premier run CI ou sur machine.
   `tsc` échoue uniquement sur `prisma-repository.ts` faute de `prisma generate`.
2. **Audit métier des lectures sensibles** (NIR/IBAN) et **coordonnées historisées** +
   **change-requests** : **reportés en sous-lot D2b** (couplé au journal `AuditLog`) →
   débloque les scénarios Gherkin 14-15.
3. **Deltas de spécification normative** (`rheos-specs-d1-d2/`) accumulés lots 2-7
   (enums, événements ✚, endpoints) : **listés** (docs/event-catalog.md, gaps.md),
   **à répercuter** sur ta validation (protocole d'évolution ADR/spec).
4. **Lighthouse** non exécuté (env) ; exigences d'installabilité réunies ; icônes SVG
   (PNG 192/512 recommandées pour un score strict).

---

**Conclusion.** Le MVP P1+P2 est fonctionnellement complet et vert en mémoire : le
cycle métier de bout en bout, l'isolation, les droits, la temporalité, le coffre-fort,
le socle temps, la PWA et l'IA cadrée sont opérationnels et testés. Les trois réserves
ci-dessus sont **environnementales ou explicitement cadrées** (D2b, répercussion specs,
run CI Postgres), sans dette cachée.
