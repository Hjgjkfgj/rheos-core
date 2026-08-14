# ADR-020 — Référentiel réglementaire plateforme

**Statut** : accepté (Lot R1). **Contexte** : Rhéos doit s'appuyer sur les **conventions
collectives réelles** (KALI/Légifrance) plutôt que sur des valeurs saisies ou codées. Ces
données ne sont **pas** propres à un tenant : elles sont **communes** à tous.

## Décision

### 1. Portée PLATEFORME (hors RLS tenant)
Les données réglementaires (`RegulatorySource`, `RegulatoryText`, `RegulatoryRule`) **ne
portent pas de `tenantId`** et **ne sont pas soumises à la Row-Level Security tenant**. Elles
constituent un **référentiel partagé**, identique pour toutes les entreprises.

- **Lecture** : tout tenant authentifié lit le référentiel (`GET /regulatory/agreements/:idcc`).
- **Écriture** : **interdite aux tenants**. Deux barrières :
  - *API* : aucune route de mutation du référentiel n'est exposée (seulement des `GET`).
  - *Base* : le rôle applicatif `rheos_app` a **SELECT seul** sur ces tables (REVOKE
    INSERT/UPDATE/DELETE, cf. `prisma/staging/rheos-app-grants.sql`). L'**ingestion** écrit via
    le rôle **admin** (`npm run regulatory:fetch`, exécuté avec l'URL admin).

*Pourquoi hors RLS ?* Le référentiel n'est pas une donnée personnelle ni concurrentielle ;
le dupliquer par tenant serait coûteux et incohérent (30 000 entreprises = 30 000 copies de
la même convention). Une source unique, versionnée, partagée, est plus juste et plus sûre.

### 2. Rattachement entreprise ↔ IDCC
Le lien se fait par l'**IDCC** déjà porté par l'établissement (`Establishment.idcc`). L'écran
convention d'une entreprise résout son IDCC → référentiel, et affiche le **texte officiel avec
sa version datée + la source KALI**. Aucun nouveau modèle de rattachement n'est nécessaire.

### 3. Cycle de vie d'une règle
Une `RegulatoryRule` (paramètre dérivé d'un texte : salaire minimum, préavis, période d'essai…)
suit : **PROPOSED → VALIDATED → PUBLISHED → SUPERSEDED**.
- Seules les règles **PUBLISHED** sont exposées et utilisables.
- **SUPERSEDED** = remplacée par une version postérieure (jamais supprimée — historique conservé).

### 4. Validation humaine par PR (v1)
En v1, la **qualification d'une règle** (traduire un article en paramètre typé) est un acte
**humain, tracé par Pull Request** : un juriste/relecteur valide le diff (`params`, `sourceRef`
= article + date d'avenant + lien) avant `PUBLISHED`. *Pourquoi ?* Transformer du droit en
paramètre est une responsabilité ; une PR fournit revue, traçabilité et réversibilité, sans
sur-ingénierie d'un workflow applicatif prématuré. Un workflow de validation en base pourra
venir plus tard (v2) sans changer le modèle.

### 5. Ingestion versionnée & idempotente
`RegulatoryText` est **versionné par IDCC** : l'ingestion calcule le **hash** du contenu source
complet. Hash identique à la version courante ⇒ **aucune nouvelle version** (idempotent).
Hash différent ⇒ **nouvelle version** + événement `RegulatoryTextUpdated`. Le contenu stocké est
un **extrait consolidé** (outline des sections/articles) ; le hash porte sur la source complète.

## Conséquences
- **+** Source de vérité unique, réelle (KALI), datée, traçable ; réversibilité (versions).
- **+** Isolation d'écriture forte (API + grants base) sans dupliquer par tenant.
- **−** L'ingestion dépend d'une source externe publique (`SocialGouv/kali-data`) — à surveiller
  (disponibilité, format). La qualification en règles reste manuelle en v1 (débit limité mais sûr).
- **Réserve** : les `RegulatoryRule` seedées doivent porter un `sourceRef` exact et être validées
  par un juriste (comme les hypothèses de `docs/gaps.md`).
