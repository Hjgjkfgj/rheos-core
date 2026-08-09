# Rhéos — Rapport de convergence `rheos-core` → specs D1/D2

**Lot 0 — Audit & plan de convergence.** Aucun code métier modifié.
Sources de vérité lues intégralement : `rheos-specs-d1-d2/` (schema.prisma,
openapi.yaml, event-catalog.md, permissions.md, d1-d2.feature, README.md).
Cible auditée : `rheos-core/` (src, prisma, test). Baseline : **86 tests verts**
sur `STORE=memory` (22 fichiers).

> Convention de statut : ✅ conforme · ⚠️ partiel / à aligner · ❌ absent.
> Références `fichier:ligne` cliquables. Ordre de préséance appliqué :
> **spec > Book > feuille de route > code** ; en cas d'écart, on aligne le code.

---

## 0. Synthèse exécutive

| Couche | État | Verdict |
|---|---|---|
| **Modèle Prisma** (28 modèles + 15 enums cibles) | field-identique à la cible, 0 différence, +14 modèles D3-D9 | ✅ **convergé** |
| **Nommage hérité** (Client→LegalEntity, Site→Establishment, Collaborator→Person+Employment) | déjà appliqué ; « Collaborateur » ne subsiste que dans des messages FR | ✅ **migration faite** |
| **Endpoints** vs `openapi.yaml` (18 opérations D1/D2) | 14 présents, 4 manquants, +extras hors contrat | ⚠️ |
| **Événements** vs catalogue (22 événements D1/D2) | 16 émis, 6 manquants, +extras | ⚠️ |
| **Permissions** vs `permissions.md` | RBAC présent ; **ABAC absent**, perms atomiques partielles | ⚠️ |
| **Audit** (invariant #10) | **aucune écriture d'audit** dans `src/` (modèle `AuditLog` inutilisé) | ❌ |
| **Données sensibles** (NIR/IBAN, scénarios 14-15) | aucun endpoint, aucune permission vérifiée, aucun journal | ❌ |
| **Isolation RLS** | policy présente sur 24 tables ; **13 tables `tenantId` sans policy** | ⚠️ |
| **Acceptation Gherkin** (15 scénarios) | 8 couverts, 5 partiels, 2 absents ; **0 tracé au `.feature`, 0 sous Prisma** | ⚠️ |

**Le gros du travail n'est pas dans le schéma (déjà convergé) mais dans la couche
runtime** : audit, ABAC, complétude événements/endpoints, journalisation des
accès sensibles, et instrumentation de la Definition of Done.

---

## 1. Convergence entité par entité (modèle actuel ↔ `schema.prisma` cible)

### 1.1 Schéma Prisma — convergence totale

Comparaison automatique des 28 modèles cibles (champ + type) entre
`rheos-specs-d1-d2/prisma/schema.prisma` et [prisma/schema.prisma](../prisma/schema.prisma) :

- **28/28 modèles cibles présents**, **0 différence de champ ou de type**.
- **+14 modèles** additionnels (domaines D3-D9) : `LeaveRequest`, `Budget`,
  `Competency`, `Training`, `CareerReview`, `Risk`, `WorkAccident`,
  `AuthorityInteraction`, `CseMandate`, `Negotiation`, `CseMeeting`, `Deadline`,
  `Shift`, `TimeEntry`.

### 1.2 Table de correspondance (mapping de migration — **déjà appliqué**)

| Existant historique (README specs) | Cible D1/D2 | Dans `rheos-core` aujourd'hui | Statut |
|---|---|---|---|
| Client | `LegalEntity` | `LegalEntity` (schéma + `services.ts:createLegalEntity`) | ✅ |
| Site | `Establishment` (+ `OperatingSite`) | `Establishment` + `OperatingSite` | ✅ |
| Collaborator | `Person` + `Employment` (+ `Contract`) | `Person`/`Employment`/`Contract` | ✅ |
| Document / signature / archive | `Document` (+ D10) | `Document` + `services-mvp.ts` | ✅ |
| licence / access | `Permission` / `UserRole` (RBAC+ABAC) | RBAC dans `auth.ts` ; **UserRole/ABAC non câblés** | ⚠️ |
| retention (RGPD) | `retentionUntil` + politique | `domain/retention.ts` + `Document.retentionUntil` | ✅ |

Aucun identifiant `Client` / `Site` / `Collaborator` ne subsiste dans `src/` (les
occurrences de « Collaborateur » sont des messages d'erreur FR, ce qui est
conforme à ADR-002 : UI/messages en français).

### 1.3 Écart de couche : modèle mémoire ↔ modèle Prisma

Le **modèle canonique est le schéma Prisma** (convergé). Le store mémoire
([src/types.ts](../src/types.ts), [src/repository.ts](../src/repository.ts))
en est une projection allégée. Points à surveiller pour la parité `memory ≡ prisma` :

| Élément | Schéma Prisma | Store mémoire (`types.ts`) | Écart |
|---|---|---|---|
| `Ctx` (contexte d'appel) | — | `{ tenantId, userId?, personId?, roles }` (types.ts:85) | **pas de `scopeType/scopeId`** → ABAC impossible (§4) |
| `BankAccount.ibanEnc` / `SensitiveIdentifier.valueEnc` | chiffré (AES) | non exposés par endpoint | pas de chemin de lecture/chiffrement (§4, §5) |
| `AuditLog` | modèle présent | **jamais écrit** | §5 |

> À valider en R5 : parité champ-à-champ du `PrismaRepository`
> ([src/prisma-repository.ts](../src/prisma-repository.ts)) avec le
> `MemoryRepository` sur toute la suite de tests.

---

## 2. Convergence endpoint par endpoint (`app.ts` ↔ `openapi.yaml`)

Base : `openapi.yaml` déclare le serveur `/api/v1` ; `app.ts` préfixe `/api/v1`. ✅

| # | Opération OpenAPI | `app.ts` | Statut / écart |
|---|---|---|---|
| 1 | `GET /companies` (liste paginée) | — | ❌ **absent** (pas de liste ; contrat `LegalEntityPage` non servi) |
| 2 | `POST /companies` | [app.ts:98](../src/app.ts#L98) | ✅ |
| 3 | `GET /companies/{id}` | [app.ts:99](../src/app.ts#L99) | ✅ |
| 4 | `GET /companies/{id}/establishments` | — | ❌ **absent** (POST présent, pas le GET liste) |
| 5 | `POST /companies/{id}/establishments` | [app.ts:100](../src/app.ts#L100) | ✅ |
| 6 | `POST /establishments/{id}/operating-sites` | [app.ts:103](../src/app.ts#L103) | ✅ |
| 7 | `POST /companies/{id}/positions` | [app.ts:106](../src/app.ts#L106) | ⚠️ ✅ route ; **n'émet pas `PositionCreated`** (§3) |
| 8 | `POST /persons` (409 doublon) | [app.ts:194](../src/app.ts#L194) | ✅ (409 supporté) |
| 9 | `POST /employments` (cascade `HireEmployee`) | [app.ts:195](../src/app.ts#L195) | ✅ |
| 10 | `GET /employments/{id}` (détail) | — | ❌ **absent** (seul `employee360` existe) |
| 11 | `GET /employments/{id}/employee360` (`?asOf=`) | [app.ts:196](../src/app.ts#L196) | ✅ (asOf géré) |
| 12 | `POST /employments/{id}/departure` | [app.ts:201](../src/app.ts#L201) | ✅ |
| 13 | `POST /employments/{id}/contracts` (créer contrat) | — | ❌ **absent** (contrat créé uniquement via cascade ; `contract.create` jamais vérifié) |
| 14 | `POST /contracts/{id}/sign` | [app.ts:203](../src/app.ts#L203) | ✅ |
| 15 | `POST /contracts/{id}/amendments` | [app.ts:206](../src/app.ts#L206) | ✅ |
| 16 | `POST /employments/{id}/assignments` | [app.ts:198](../src/app.ts#L198) | ✅ |
| 17 | `POST /persons/{id}/documents` | [app.ts:224](../src/app.ts#L224) | ✅ |
| 18 | `GET /companies/{id}/registry` (`?format=`) | [app.ts:109](../src/app.ts#L109) | ⚠️ route ✅ ; **paramètre `format=json\|csv\|pdf` ignoré** + export non journalisé (§5) |

**Bilan : 14/18 conformes, 4 manquants** (liste sociétés, liste établissements,
détail employment, création de contrat autonome).

**Extras hors contrat D1/D2** (présents dans `app.ts`, non décrits par cet
`openapi.yaml` — domaines D3-D9 et transverses) : `/me/*`, `/notifications`,
`/conventions/*`, `/deadlines`, `/cse/*`, `/negotiations`, `/authority/*`,
`/risks`, `/duerp`, `/accidents`, `/competencies`, `/reviews`, `/trainings`,
`/pilotage`, `/budgets`, `/org-chart`, `/payroll-input`, `/rh-officer/briefing`,
`/leave-requests`, `/shifts`, `/time-entries`. → à documenter dans un OpenAPI
étendu (ou à retirer du périmètre MVP selon la feuille de route).

---

## 3. Événements émis ↔ `event-catalog.md`

Enveloppe : `EventBus.publish` ([events.ts:16](../src/events.ts#L16)) produit
`{ id, tenantId, aggregateType, aggregateId, type, version, sequence, payload,
occurredAt, actorUserId }` — conforme à l'enveloppe du catalogue (le champ
`eventId` du catalogue = `id` du modèle `DomainEvent`). Persistance append-only
branchée via `bus.onPersist` ([app.ts:31](../src/app.ts#L31)). ✅

### 3.1 D1 — Entreprise & Référentiel

| Événement catalogue | Émis ? | Emplacement |
|---|---|---|
| `CompanyCreated` | ✅ | services.ts:28 |
| `CompanyUpdated` | ❌ | pas d'update d'entité |
| `EstablishmentCreated` | ✅ | services.ts:45 |
| `EstablishmentClosed` | ❌ | pas de fermeture d'établissement |
| `OperatingSiteCreated` | ✅ | services.ts:54 |
| `PositionCreated` | ❌ | `createPosition` n'émet rien |
| `AgreementLinked` | ❌ | pas de rattachement de convention événementiel |
| `WorkforceThresholdCrossed` | ✅ | services.ts:148 |
| `ObligationTriggered` | ✅ | services.ts:163 |

### 3.2 D2 — Gestion administrative & dossier

| Événement catalogue | Émis ? | Emplacement |
|---|---|---|
| `PersonCreated` | ✅ | services.ts:91 / 110 |
| `EmployeeHired` | ✅ | services.ts:139 |
| `ContractCreated` | ✅ | services.ts:140 |
| `ContractSigned` | ✅ | services.ts:200 |
| `ContractActivated` | ✅ | services.ts:202 |
| `AmendmentCreated` | ✅ | services.ts:214 |
| `AmendmentSigned` | ✅ | services.ts:224 |
| `EmployeeAssigned` | ✅ | services.ts:141 / 248 |
| `EmployeeMobility` | ✅ | services.ts:249 |
| `AddressChanged` | ❌ | pas de gestion d'adresse historisée |
| `BankAccountRegistered` | ❌ | pas d'enregistrement bancaire |
| `DocumentDeposited` | ✅ | services-mvp.ts:36 |
| `EmployeeDeparture` | ✅ | services.ts:259 |

**Bilan : 16/22 émis ; 6 manquants** (`CompanyUpdated`, `EstablishmentClosed`,
`PositionCreated`, `AgreementLinked`, `AddressChanged`, `BankAccountRegistered`).

**Extras hors catalogue** (à ajouter au catalogue s'ils restent, ou hors MVP) :
`AmendmentApplied`, `DocumentSigned`, `SignatureRequested`, `LeaveRequested/
Approved/Refused`, `ShiftPlanned`, `TimeRecorded`, `PayrollVariablesPrepared`,
`DeadlineCreated`, `CseMandateCreated`, `CseMeetingPlanned/Held`,
`NegotiationOpened`, `RiskAssessed`, `WorkAccidentDeclared`, `CompetencyAdded`,
`TrainingPlanned/Completed`, `ReviewPlanned`, `BudgetSet`, `AuthorityInteraction*`.

> ⚠️ Nommage : `AmendmentApplied` applique un patch au contrat
> ([services.ts:231](../src/services.ts#L231)). Vérifier que l'invariant « un
> avenant n'écrase jamais le contrat » (Contract V1 → Amendment → V2) est bien
> respecté par versionnement et non par mutation en place (à confirmer en R4).

---

## 4. Permissions actuelles ↔ `permissions.md`

RBAC implémenté par une table rôle→permissions codée
([auth.ts:4](../src/auth.ts#L4)) ; `assertCan` appelé dans les services (défense
côté service). **Deux écarts structurels majeurs.**

### 4.1 Écart structurel #1 — **ABAC absent** (invariants #7, #9)

- `Ctx` ne porte **ni `scopeType` ni `scopeId`** ([types.ts:85](../src/types.ts#L85)).
- `can()` ne teste que `role → permission` ; **aucun contrôle de périmètre**
  (TENANT / LEGAL_ENTITY / ESTABLISHMENT / ORG_UNIT / SELF).
- Le cas « SELF » est simulé par une permission-chaîne `employee360.read.self`
  ([auth.ts:18](../src/auth.ts#L18)) + endpoints `/me/*`, au lieu du scope ABAC
  `SELF` du modèle `UserRole.scopeType`.
- Conséquence : « droits appliqués **avant** agrégation » (invariant #9) non
  garanti pour `employee360` (pas de filtrage équipe/établissement).

### 4.2 Écart structurel #2 — **permissions atomiques partielles**

| Permission spec | Dans `auth.ts` | Vérifiée (`assertCan`) ? |
|---|---|---|
| `company.read/write` | ✅ | ✅ |
| `establishment.write` | ✅ | ✅ (services.ts:39) |
| `establishment.close` | ❌ | — (pas de fermeture) |
| `organization.read/write` | write ✅ / read ❌ | write ✅ |
| `person.read/write` | write ✅ / read ❌ | write ✅ |
| `person.sensitive.read` | ❌ | ❌ **manquant** (NIR non protégé) |
| `bank_account.read/write` | read listé (PayrollOfficer) | ❌ **jamais vérifié** (pas d'endpoint) |
| `employment.read/write` | write ✅ / read (PayrollOfficer) | write ✅ |
| `employment.departure` | ✅ | ✅ (services.ts:254) |
| `contract.read` | listé (PayrollOfficer) | ❌ jamais vérifié |
| `contract.create` | listé | ❌ **jamais vérifié** (contrat via cascade) |
| `contract.validate` | listé | ❌ **jamais vérifié** |
| `contract.sign` | ✅ | ✅ (services.ts:195) |
| `amendment.create/sign` | ✅ | ✅ (create≠sign respecté) |
| `assignment.write` | ✅ | ✅ |
| `document.read/write` | ✅ | ✅ |
| `document.delete` | ❌ | — |
| `registry.read/export` | export ✅ / read ❌ | export ✅ |
| `employee360.read` | ✅ | ✅ |
| `audit.read` | ❌ | ❌ **manquant** |
| `tenant.admin` / `platform.admin` | `TenantAdmin=["*"]` ; platform ❌ | rôle joker `*` |

**Permissions hors spec ajoutées** (D3-D9, à formaliser ou sortir du périmètre) :
`document.sign`, `leave.request/approve`, `planning.read/write`, `time.record`,
`talent.*`, `health.*`, `social.*`, `authority.*`, `finance.*`,
`notifications.read`, `payroll.prepare`, `employee360.read.self`.

> **Bien respecté** : la séparation « créer ≠ signer » est effective pour les
> contrats et avenants (`contract.sign`, `amendment.sign` distincts). Le trou est
> côté `create/validate` (jamais matérialisés en endpoint/contrôle).

### 4.3 Modèle RBAC en dur vs modèle DB

Les permissions sont une **table de configuration** en code
([auth.ts:4](../src/auth.ts#L4)), pas les tables `Role`/`Permission`/`UserRole`/
`RolePermission` du schéma. Acceptable au MVP (ce ne sont pas des règles
*légales* codées en dur, cf. invariant #6) mais à faire migrer vers un **seed**
des rôles/permissions pour permettre l'ABAC scopé (R3).

---

## 5. Audit & données sensibles (invariants #10, #11 ; scénarios 14-15)

- **Aucune écriture d'audit** dans `src/` : recherche `audit|AuditLog` = 0 dans
  les services. Le modèle `AuditLog` (qui/quand/quoi/avant/après) existe mais
  n'est **jamais alimenté**. ❌ (invariant #10)
- **Aucun endpoint** de lecture des coordonnées bancaires (`BankAccount`) ni des
  identifiants sensibles (`SensitiveIdentifier`) → scénarios 14/15 non
  implémentables en l'état. ❌
- `employee360` ne masque pas explicitement les champs sensibles selon le rôle
  (pas de filtrage avant agrégation). ⚠️
- Chiffrement `ibanEnc`/`valueEnc` : prévu au schéma, **pas de chemin de
  chiffrement/déchiffrement** côté service. ⚠️

---

## 6. Isolation RLS — couverture des policies

`prisma/migrations/0001_init/rls.sql` : rôle non-superutilisateur `rheos_app`,
`current_setting('app.tenant_id')`, `FORCE ROW LEVEL SECURITY`. Principe ✅.

**Écart : 24 tables protégées sur 37 porteuses de `tenantId`.** 13 tables des
domaines D3-D9 **n'ont aucune policy RLS** (défense en profondeur incomplète) :
`Budget`, `Competency`, `Training`, `CareerReview`, `Risk`, `WorkAccident`,
`AuthorityInteraction`, `CseMandate`, `Negotiation`, `CseMeeting`, `Deadline`,
`Shift`, `TimeEntry`.

De plus, l'application du `SET LOCAL app.tenant_id` par transaction dans le
`PrismaRepository`, et la **parité `memory ≡ prisma`** sous RLS réelle, ne sont
**pas prouvées** (les 86 tests tournent en `STORE=memory`). À traiter en R5.

---

## 7. Couverture des scénarios `d1-d2.feature` par les tests

15 scénarios / 6 fonctionnalités. **Aucun test ne référence le `.feature`** (pas
de harnais Gherkin) et **aucun ne tourne sous `STORE=prisma`** : la couverture
ci-dessous est fonctionnelle (via memory store), pas tracée à la Definition of Done.

| # | Scénario (`.feature`) | Test le plus proche | Statut |
|---|---|---|---|
| 1 | Créer une entité juridique valide (201 + `CompanyCreated` + tenant) | (création via engines/hire) | ⚠️ pas de test dédié aux 3 assertions |
| 2 | Refuser un SIREN invalide → 400 « siren » | hire-and-contract:16 | ✅ |
| 3 | Interdire un SIREN doublon (même tenant) → 400 | hire-and-contract:21 | ✅ |
| 4 | Créer un établissement + `EstablishmentCreated` | (createEstablishment) | ⚠️ événement non asserté en test |
| 5 | Un tenant ne lit pas les données d'un autre → 404 | tenant-isolation:6 | ✅ (memory) |
| 6 | Embauche → cascade + `EmployeeHired` | hire-and-contract:27 | ✅ |
| 7 | Doublon Person → 409 + candidats, pas de fusion | hire-and-contract:46 | ✅ |
| 8 | Création ≠ signature (RH 403 / DG 200, SIGNED→ACTIVE, 2 événements) | hire-and-contract:54 | ✅ |
| 9 | Contrat signé non modifiable en silence (avenant + historique) | org-amendment:41 | ⚠️ couvert via create→sign→apply ; assertion `AmendmentCreated` + version antérieure à préciser |
| 10 | Reconstruire l'état à une date passée (`asOf`) | temporal-and-registry:22 | ✅ |
| 11 | Mobilité ne détruit pas l'historique | temporal-and-registry:34 | ✅ |
| 12 | Déclarer une sortie (EXITING→ENDED + `EmployeeDeparture`) | temporal-and-registry:48 | ⚠️ événement ✅ ; transition d'état à la date d'effet + rétention non assertées |
| 13 | RUP généré + **export journalisé** | temporal-and-registry:56 | ⚠️ lignes ✅ ; **journalisation absente** (§5) |
| 14 | Coordonnées bancaires non exposées + accès direct → 403 | — | ❌ **absent** |
| 15 | Accès sensible journalisé (PayrollOfficer lit IBAN → audit) | — | ❌ **absent** |

**Bilan : 8 ✅ · 5 ⚠️ · 2 ❌.** Les 2 absents (14, 15) et le trou d'audit du 13
dépendent tous du chantier **Audit & données sensibles** (§5).

---

## 8. Plan de refactor ordonné (sans code ici)

Séquencement par dépendances et par gates ADR. Chaque lot : spec lue → plan →
tests générés avec le code → migration si schéma → résumé. Gate « Validation
d'Aymeric » entre les lots.

| Lot | Objectif | Débloque | Risque | Contenu principal |
|---|---|---|---|---|
| **R0** ✅ | *Ce rapport* + linter de vocabulaire | mesure des écarts | nul | `docs/convergence-report.md`, `scripts/vocab-lint.mjs` |
| **R1** | **Instrumenter la DoD** | tous | faible | Harnais d'acceptation 1-pour-1 des 15 scénarios (`test/acceptance/*`, tracé au `.feature`) ; CI (lint + typecheck + `test` memory **et** prisma + `lint:vocab`) ; `git init` |
| **R2** | **Audit & données sensibles** | scénarios 13, 14, 15 ; invariants #10-11 | moyen | Chemin d'écriture `AuditLog` (qui/quand/quoi/avant/après/motif) ; journalisation des lectures sensibles ; endpoints `bank_account`/`sensitive` en lecture restreinte ; masquage `employee360` **avant** agrégation ; chiffrement `ibanEnc`/`valueEnc` |
| **R3** | **ABAC** (périmètres) | invariants #7, #9 | moyen-élevé | `Ctx.scopes` depuis le JWT + `UserRole` ; moteur `tenant ∧ RBAC ∧ ABAC` ; application avant agrégation (équipe/établissement/SELF) ; retrait du hack `employee360.read.self` ; seed `Role`/`Permission` |
| **R4** | **Compléter contrat & catalogue** | conformité OpenAPI + événements | faible-moyen | Endpoints manquants (#1, #4, #10, #13 du §2) + `registry ?format` ; événements manquants (§3) ; matérialiser `contract.create`/`contract.validate` (create ≠ validate ≠ sign) ; vérifier « avenant n'écrase pas le contrat » |
| **R5** | **Parité Prisma + RLS** | DoD « prisma ≡ memory » + preuve d'isolation | élevé | Toute la suite sous `STORE=prisma` ; `SET LOCAL app.tenant_id` par transaction ; test d'isolation inter-tenant **sous RLS réelle** ; compléter les policies RLS des 13 tables manquantes (§6) |
| **R6** | **Vocabulaire bloquant** | invariant #15 | nul | Corriger les 2 violations UI (§9) ; `lint:vocab` bloquant en CI |

> Ordre recommandé : **R1 d'abord** (transforme chaque écart en signal vert/rouge),
> puis R2 (débloque 3 scénarios et une classe d'invariants), puis R3→R4→R5, R6 en
> continu. R5 exige un PostgreSQL actif (hors de ce bac à sable).

---

## 9. Linter de vocabulaire livré (`scripts/vocab-lint.mjs`)

Deux contrôles, sans dépendance, exécutables via `npm run lint:vocab` :

- **(A) UI / doc** — échec si un terme interdit du glossaire (Tome 01 §4)
  apparaît dans les surfaces produit (`web/`, `README.md`) : `salarié(s/e/es)`,
  `employé(s/e/es)`, `dossier salarié`, `fiche salarié`, `planning hebdo`
  → terme officiel « collaborateur ». **L'accent est exigé** pour ne pas capturer
  l'anglais (`salaries`, `employee`). Termes contextuels écartés des erreurs
  (revue manuelle) : `personnel` (« registre du personnel » = terme légal),
  `site` (« Site Marseille » = nom propre), `employeur` (contextuel).
- **(B) Code** — échec si un **identifiant** contient un mot français métier
  (ADR-002 : code/BDD/API en anglais). Commentaires et chaînes (messages
  d'erreur FR autorisés) **ignorés** — seuls les identifiants sont analysés.

Échappatoire : une ligne contenant `vocab-ignore` est sautée. Le dictionnaire
est en tête de script (donnée configurable, alignée sur le glossaire).

**État actuel (2 violations « error », non corrigées — hors périmètre Lot 0) :**

| Fichier:ligne | Violation | Correctif |
|---|---|---|
| `web/index.html:347` | « dès 11 **salariés** » (texte UI visible) | → « collaborateurs » |
| `web/espace.html:114` | commentaire « Jeton **employé** (démo) » | → reformuler / `vocab-ignore` |

Contrôle **(B)** : **0 violation** (le code est déjà anglicisé). Les deux
contrôles ont été validés par auto-test (les homographes anglais `employees` /
`salaries` ne sont pas capturés ; un identifiant `getSalarieDossier` l'est bien).

---

## 10. Décisions & hypothèses de l'audit

- **Périmètre du linter UI/doc** limité à `web/` + `README.md` (surfaces produit) ;
  `docs/` (notes d'ingénierie internes, dont ce rapport qui *cite* des termes
  interdits) est exclu pour éviter l'auto-flag. Ajustable via les racines en tête
  de script.
- **`personnel` / `site` / `employeur`** volontairement hors des erreurs
  bloquantes (fort taux de faux positifs légitimes). À traiter en revue manuelle.
- Les **domaines D3-D9** présents dans `rheos-core` dépassent le périmètre MVP
  (P1+P2). Ils sont signalés (endpoints, événements, permissions, RLS) mais leur
  alignement complet n'est **pas** un objectif du MVP — décision à confirmer.
- Rapport établi **par lecture des fichiers** ; les numéros de ligne renvoient à
  l'état du dépôt au moment de l'audit.

**Question ouverte pour Aymeric** — valides-tu ce rapport et le séquencement
R1→R6 ? Démarre-t-on par **R1 (instrumenter la DoD)** ?
