# Rhéos — État des lieux & audit d'écart vs la vision Book

> **But de ce document** : te permettre (non-développeur) de comprendre *précisément* ce
> qui est construit, à quoi chaque brique sert, et **honnêtement** l'écart avec la cible du
> Book — un « OS RH » (système d'exploitation des ressources humaines : la plateforme
> centrale qui gère tout le cycle RH) capable de servir des milliers d'entreprises
> (cible feuille de route : **250 clients / 600 sites / 1 M de collaborateurs**).
>
> **Posture** : auditeur externe sévère, pas auteur. Chaque section « limites » est aussi
> fournie que « réalisé ». Aucune note complaisante.

## Règle de preuve (les 4 niveaux)
Chaque capacité est classée sur une échelle stricte. **Un ✅ sans preuve citée est interdit.**

- **CODÉ** — le code existe (fichier cité).
- **TESTÉ** — un test automatisé passe au vert (fichier de test cité). *Un « test automatisé »
  est un petit programme qui vérifie tout seul qu'une fonction se comporte comme prévu.*
- **DÉPLOYÉ** — vérifié **par moi sur https://staging.rheos-corp.fr** (l'environnement en
  ligne, pas mon ordinateur), avec la preuve : requête + réponse réelle. *« Staging » = un
  clone de production, en ligne, pour tester avant les vrais clients.*
- **VALIDÉ** — recette humaine ou juridique faite (un humain métier ou un avocat a confirmé).

> **Incident de référence** : `/confidentialite` avait été annoncé « en ligne » alors qu'il
> renvoyait 404 sur staging (vérifié seulement en local). Corrigé. **Ce document ne classe
> DÉPLOYÉ que ce que j'ai re-testé sur staging aujourd'hui**, réponses à l'appui.

**Base de preuve TESTÉ** : `205 tests automatisés verts` sur 38 fichiers (commande
`STORE=memory npx vitest run`). **Base de preuve DÉPLOYÉ** : batterie de requêtes exécutées
ce jour sur staging (login réel `admin@acme` → parcours complet), réponses reproduites ci-dessous.

---

# 1. Ce que fait Rhéos aujourd'hui (inventaire pédagogique)

Pour chaque capacité : ce que ça fait pour un DRH, le parcours concret, l'emplacement dans le
code, et son niveau avec preuve.

### D1 — Entreprise & Référentiel
*« Le socle : qui est l'entreprise, ses établissements, ses conventions, ses obligations. »*

- **Ce que ça fait** : créer une entreprise (avec contrôle du SIREN — *numéro d'identité à
  9 chiffres de l'entreprise* — et refus des doublons), y rattacher des établissements
  (fermeture possible sans jamais supprimer l'historique), calculer l'**effectif** et en
  déduire automatiquement les **obligations légales** déclenchées par les seuils (11, 50…),
  simuler « et si j'embauche N personnes ? ».
- **Parcours** : Console → Entreprise & Référentiel → Créer une société → Ajouter un
  établissement → Effectif & obligations.
- **Code** : `src/services.ts`, `src/domain/thresholds.ts` (seuils **datés**, pas codés en
  dur), `src/domain/convention.ts`.
- **Book** : D1 ; socle conceptuel T03 (modèle de données).
- **Niveau** :
  - CODÉ ✅ · TESTÉ ✅ `test/acceptance/d1.test.ts`, `test/thresholds.test.ts`,
    `test/engines.test.ts`.
  - **DÉPLOYÉ ✅** — staging : `GET /companies/{id}/workforce` → `headcount=1, obligations=0` ;
    `GET /companies/{id}/registry` → `1 ligne, siret=90000000500013`.

### D2 — Dossier collaborateur
*« Embaucher, contractualiser, faire évoluer, faire sortir — sans jamais réécrire l'histoire. »*

- **Ce que ça fait** : une seule action d'**embauche en cascade** crée la Personne, la
  **Relation de travail** (le lien d'emploi, distinct de la personne) et le **Contrat** en
  brouillon. La **séparation des droits** est stricte : le RH *valide*, seul le signataire
  *signe*. Les évolutions passent par des **avenants** (l'ancien contrat n'est jamais écrasé).
  On peut reconstituer l'état du dossier **à une date passée** (`?asOf=`). Le **Registre
  Unique du Personnel** est *calculé* à la volée, jamais tenu en double.
- **Parcours** : Gestion administrative → Éditer une embauche → Signer le contrat (DG) →
  Dossier collaborateur (360).
- **Code** : `src/services.ts` (D2), `src/services-me.ts` (self-service).
- **Book** : D2 ; jumeau numérique T05 (le « double » fidèle du collaborateur dans le temps).
- **Niveau** :
  - CODÉ ✅ · TESTÉ ✅ `test/acceptance/d2.test.ts`, `test/hire-and-contract.test.ts`,
    `test/temporal-and-registry.test.ts`, `test/acceptance/full-cycle.test.ts`.
  - **DÉPLOYÉ ✅** — staging : embauche → `relation=PRE_HIRE, contrat=DRAFT` ; signature par
    le DG → `contrat=ACTIVE` ; `employee360` → `contrat=ACTIVE, timeline=1`.

### D2b — Données sensibles (NIR, IBAN)
*« Le numéro de sécurité sociale et le compte bancaire : chiffrés, lecture tracée. »*

- **Ce que ça fait** : enregistrer un IBAN / NIR **chiffré au repos** (illisible sans la clé),
  n'afficher que les 4 derniers chiffres, tracer toute lecture en clair. Demandes de
  changement self-service validées par le RH.
- **Code** : `src/services-sensitive.ts`, `src/crypto.ts` (chiffrement AES-256-GCM).
- **Book** : D2 (scénarios 14-15), T04 (identités & droits).
- **Niveau** :
  - CODÉ ✅ · TESTÉ ✅ `test/acceptance/d2b-sensitive.test.ts`.
  - **DÉPLOYÉ ✅** — staging : enregistrement IBAN → `last4=0143, statut=FURNISHED` (valeur
    complète jamais renvoyée).
  - **Limite** : la **rotation de la clé de chiffrement** est un script manuel (`reencrypt.mjs`),
    non automatisée ; l'accès à la valeur *déchiffrée* n'a pas été rejoué sur staging ici.

### D3 — Temps & absences (socle)
*« Poser un congé, le faire valider, décompter les jours ouvrables, tenir un solde juste. »*

- **Ce que ça fait** : demande de congé → validation manager → (RH) → approuvé ; décompte des
  **jours ouvrables** hors fériés/fermetures ; solde reconstruit depuis un **grand livre
  append-only** (*un journal où l'on n'efface jamais : on ajoute des lignes, et le solde se
  recalcule*). Planning et pointage simples.
- **Code** : `src/domain/leave.ts`, `src/services-mvp.ts`, `src/services-time.ts`.
- **Book** : D3 ; spec dédiée `docs/spec-absences.md`.
- **Niveau** :
  - CODÉ ✅ · TESTÉ ✅ `test/leave-socle.test.ts`, `test/time.test.ts`, `test/planning.test.ts`.
  - **DÉPLOYÉ ✅** — staging : congé 1→5 juillet → `jours=4, statut=REQUESTED`.
  - **Limite** : pas d'annualisation, pas de règles de temps complexes (modulation,
    équivalences), pas de compteurs RTT/CET avancés — **socle**, pas moteur temps complet.

### D10 — Coffre-fort documentaire
*« Sceller un document par empreinte numérique, prouver qu'il n'a pas été modifié. »*

- **Ce que ça fait** : déposer un document scellé par une **empreinte SHA-256** (*une
  signature numérique unique du contenu : le moindre changement la casse*), vérifier son
  intégrité, gérer un cycle de vie (brouillon → … → archivé), un **legal hold** (blocage de
  toute suppression en cas de litige), et distinguer strictement supprimer / anonymiser / archiver.
- **Code** : `src/services-mvp.ts` (D10), `src/signature.ts`, `src/domain/retention.ts`.
- **Book** : D10.
- **Niveau** :
  - CODÉ ✅ · TESTÉ ✅ `test/d10-vault.test.ts`, `test/vault.test.ts`.
  - **DÉPLOYÉ ✅** — staging : dépôt → `sha256=ba7816bf8f01cfea…` ; vérification contenu exact
    → `valid=true` ; contenu altéré → `valid=false`.
  - **⚠️ ERRATUM — CORRIGÉ PAR LE LOT 19** : à la rédaction de cet audit, **le contenu binaire
    du document n'était stocké nulle part** (seule l'empreinte + un `storageRef` placeholder) —
    un registre d'intégrité, pas un coffre-fort de fichiers. **Le Lot 19 a comblé ce trou** :
    contenu chiffré (AES-256-GCM, clé par tenant) écrit dans **Scaleway Object Storage**,
    téléchargement avec droits + intégrité recalculée + journalisation, suppression contrôlée
    qui retire réellement l'objet (legal hold bloquant). **DÉPLOYÉ ✅ (prouvé sur staging)** :
    dépôt d'un vrai PDF → retéléchargement → **hash identique** ; objet présent dans le bucket
    **et chiffré au repos** (1ers octets ≠ `%PDF`) ; accès d'un autre tenant → **404**.
    TESTÉ ✅ `test/document-storage.test.ts`. Cette ligne remonte donc le D10 de « registre
    d'intégrité » à **coffre-fort réel** (voir §3, corrigé lui aussi).

### IA « cadrée » (assistant, briefing, extraction)
*« Un assistant RH qui ne révèle jamais une donnée hors droits, et un briefing quotidien. »*

- **Ce que ça fait** : extraction de champs d'un texte (avec seuil de confiance, jamais une
  validation), **briefing** quotidien du « Digital RH Officer » (synthèse effectif +
  recommandations), assistant de lecture qui **refuse** toute donnée hors périmètre.
- **Code** : `src/domain/extraction.ts`, `src/services-rh-officer.ts`, `src/services-assistant.ts`.
- **Book** : T06 (IA-native), ADR-010 (IA R0-R2 : lecture seule, humain décide).
- **Niveau** :
  - CODÉ ✅ · TESTÉ ✅ `test/ai-cadree.test.ts`, `test/extraction.test.ts`, `test/rh-officer.test.ts`.
  - **DÉPLOYÉ ✅** — staging : `GET /rh-officer/briefing` → `version=briefing-v1, effectif=1`.
  - **⚠️ Limite MAJEURE** : **il n'y a AUCUNE IA réelle (aucun appel à un modèle de langage /
    LLM)**. Ces fonctions sont des **moteurs déterministes** (règles fixes) *conçus pour être
    reformulés par un LLM plus tard sans altérer les faits*. La vision « OS RH cognitif /
    IA-native » du Book est **à ~25 % réalisée** : l'ossature de sécurité IA existe, le cerveau non.

### Transverse — sécurité, multi-tenant, PWA
- **Sécurité** : RBAC (*chaque rôle a une liste de permissions atomiques*) + ABAC (*périmètres :
  ce rôle n'agit que sur tel établissement*) ; en-têtes de sécurité + limitation de débit ;
  refus de démarrage sur un rôle base trop privilégié. `src/auth.ts`, `src/security.ts`,
  `src/db-guard.ts`. TESTÉ ✅ `test/rbac-abac.test.ts`, `test/security.test.ts`,
  `test/tenant-isolation*.test.ts`, `test/auth.test.ts`. DÉPLOYÉ ✅ — staging : appel sans
  jeton → `401`.
- **Isolation multi-tenant** (*chaque entreprise cloisonnée : aucune ne voit les données d'une
  autre*) par **RLS PostgreSQL** (*règle en base qui filtre chaque requête sur l'entreprise
  courante*). DÉPLOYÉ ✅ (preuve dédiée : `scripts/rls-check.mjs` exécuté contre la base
  staging au Lot 15 : « A ne voit que A, 0 hors contexte »).
- **Import/Export** (Lot 16) : import massif CSV avec rapport + idempotence ; export CSV/JSON.
  TESTÉ ✅ `test/import.test.ts` (12 tests). DÉPLOYÉ ✅ — staging : `export?format=json` répond.
- **Droits des personnes RGPD** (Lot 17) : export « droit d'accès » PDF+JSON journalisé ;
  anonymisation. TESTÉ ✅ `test/privacy.test.ts`. DÉPLOYÉ ✅ — staging : access-request JSON+PDF
  (PDF reconnu `PDF document, version 1.4`), `POST /anonymize` sur collaborateur actif → `409`.
- **Page confidentialité** : DÉPLOYÉ ✅ — `GET /confidentialite` → `200`.
- **PWA collaborateur** (*application web installable sur mobile comme une app*) : `web/espace.html`
  + manifest + service worker. TESTÉ ✅ `test/front.test.ts`. **DÉPLOYÉ ⚠️** — servie, mais
  l'installabilité mobile réelle (Lighthouse) **n'a pas été re-vérifiée sur staging** ; VALIDÉ ❌.

### Infrastructure & déploiement
- Container Serverless Scaleway (fr-par), base PostgreSQL managée, CI/CD (déploiement
  automatique au merge), sauvegarde chiffrée + **restauration prouvée**, secrets hors code.
- DÉPLOYÉ ✅ — `GET /health` → `{"db":true}` ; le déploiement de ce lot lui-même a été prouvé
  sur staging (page apparue ~170 s après merge). Voir `docs/runbook-staging.md`.

---

# 2. Couverture du Book, domaine par domaine

> **% = mon estimation d'auditeur** de la part du domaine *tel que décrit dans le Book* qui
> est réellement livrée (pas juste ébauchée). Justifiée à chaque ligne.

### Socles transverses
- **T03 — Modèle conceptuel** : **~80 %**. Le schéma de données (28 modèles cibles + 14 extras)
  est convergé sans écart (`docs/convergence-report.md §1`). Manque : hiérarchie de groupes
  profonde, unités organisationnelles (`OrgUnit`) peu exploitées.
- **T04 — Identités & droits** : **~60 %**. RBAC atomique **solide et testé** ; ABAC (périmètres)
  **câblé mais partiellement appliqué** (beaucoup d'endpoints ne vérifient que la permission,
  pas le périmètre — les jetons de démo posent un périmètre sans identifiant). Pas de
  fournisseur d'identité externe (SSO), pas de MFA.
- **T05 — Jumeau numérique** : **~70 %**. Temporalité `?asOf=` + événements append-only +
  projections (RUP, Employee 360) réels. Manque : bitemporalité *complète* (le « temps de
  transaction » — quand on a su la chose — n'est que partiellement distinct du « temps métier »).
- **T06 — IA-native** : **~25 %**. Ossature de sécurité IA (R0-R2) réelle et testée, mais
  **aucun modèle de langage branché** : le « cognitif » est simulé par des règles.

### Domaines métier
| Domaine | Couverture | Fait | Manque (explicite) | Nature du manque |
|---|---|---|---|---|
| **D1 Référentiel** | ~70 % | entreprise, établissements, effectif, obligations, conventions datées, simulation | groupes multi-niveaux, exhaustivité des obligations, calcul d'effectif ETP/moyenne 12 mois | trou de spec (gaps §2) + P5+ |
| **D2 Dossier** | ~75 % | embauche cascade, séparation droits, avenants, `asOf`, RUP, départ | quelques endpoints du contrat OpenAPI, masquage fin par rôle dans employee360 | oubli mineur + P5+ |
| **D2b Sensible** | ~65 % | NIR/IBAN chiffrés, lecture auditée, change requests | rotation clé automatisée, coffre à secrets géré, gestion fine des habilitations sensibles | confort + prod |
| **D3 Temps** | ~55 % | congés (workflow, ledger, ouvrables), planning/pointage basiques | annualisation, modulation, RTT/CET, badgeuse, règles conventionnelles de temps | prévu P5+ |
| **D4 Prépa paie** | ~35 % | agrégation des variables (base, congés, heures) | **le calcul de paie n'est pas fait** (délégué à un partenaire **non intégré**), DSN, bulletins | par conception (calcul délégué) + prod |
| **D5 Pilotage** | ~30 % | masse salariale, coût employeur, simulateur de coûts, budget | tableaux de bord réels, analytics, indicateurs RH (turnover, absentéisme), BI | prévu P5+ |
| **D6 Santé/Prévention** | ~30 % | DUERP (cotation risques), accidents, échéances | suivi médical réel, programme de prévention, pénibilité | prévu P5+ |
| **D7 Carrière** | ~30 % | compétences, formations, entretiens (CRUD) | matrice de compétences, GPEC, plan de développement, mobilité outillée | prévu P5+ |
| **D8 Social/IRP** | ~30 % | mandats CSE, réunions/PV, NAO (CRUD) | processus électoral, BDESE réelle, calcul des heures de délégation | prévu P5+ |
| **D9 Autorités** | ~30 % | interactions (contrôles, courriers), échéances | intégrations réelles (DSN, URSSAF, inspection), télédéclarations | prévu P5+ / prod |
| **D10 Coffre-fort** | ~55 % | scellé SHA-256, intégrité, cycle de vie, legal hold, rétention | **stockage réel des fichiers**, signature eIDAS réelle (aujourd'hui OTP-stub) | oubli structurant + prod |

> **Lecture d'ensemble honnête** : le **noyau MVP (D1, D2, D2b, D3-socle, D10-métadonnées)**
> est **profond, testé et déployé (~65-75 %)**. Les **domaines D4 à D9 sont larges mais peu
> profonds (~30 %)** : ce sont surtout des CRUD (*créer/lire/modifier/supprimer*) qui posent la
> structure, pas encore les vrais moteurs métier. C'est **cohérent avec une stratégie MVP**
> (aller large pour montrer, approfondir après pilote) — à condition de ne pas les vendre comme finis.

**Verdict couverture Book global : ~45-50 %** d'un « OS RH de bout en bout », tiré vers le haut
par un noyau solide, tiré vers le bas par D4-D9 superficiels, l'IA non réelle, et l'absence de
stockage documentaire et de preuves d'échelle.

---

# 3. Tiendrait-il des milliers d'entreprises ? (scalabilité honnête)

> Rappel cible : **250 clients / 600 sites / 1 M de collaborateurs**. Verdict global d'entrée :
> **l'infrastructure actuelle est dimensionnée pour un PILOTE (quelques dizaines d'entreprises,
> quelques milliers de collaborateurs), pas pour la cible.** Détail par dimension.

- **Architecture (monolithe Fastify)** — *un seul programme qui fait tout.* Sans état (*ne garde
  rien en mémoire entre deux requêtes*, à part le bus d'événements), donc **duplicable
  horizontalement** en principe. **OK jusqu'à ~quelques centaines de tenants** si on ajoute des
  instances. **À changer** : découper en services quand un domaine deviendra un goulot ; **quand** :
  après le pilote, si la charge le justifie. *Pas un blocage d'architecture, un blocage de dimensionnement.*
- **Base PostgreSQL DEV-S (1 vCPU) + RLS** — le RLS ajoute un `SET LOCAL` par transaction (coût
  négligeable) ; **le vrai plafond est la taille de l'instance**. **OK pour un pilote**
  (dizaines de tenants, milliers de collaborateurs). **PAS pour 1 M de collaborateurs.** **À
  changer** : instance plus grosse + **réplicas de lecture** + pooling ; **quand** : dès la montée
  en charge. Aujourd'hui **une seule instance, sans haute disponibilité ni réplica** → point unique de panne.
- **Serverless Container 512 Mo, min 1 / max 2** — *au plus 2 exemplaires de 512 Mo.* Très petit :
  **OK pour une démo / un pilote à faible concurrence**, insuffisant au-delà. **À changer** : relever
  max-scale + mémoire ; trivial, mais **rien ne prouve la tenue en charge** (voir ci-dessous).
- **Absence de tests de charge** — **il n'existe AUCUN test de charge.** *On ne connaît donc pas
  empiriquement le nombre de requêtes/seconde soutenables.* Toutes les estimations ci-dessus sont
  **argumentées, pas mesurées.** **À faire avant toute promesse d'échelle.**
- **Pooling de connexions** — Prisma limité à `connection_limit=5` par instance ; seuil de bascule
  vers **PgBouncer** (*un intermédiaire qui mutualise les connexions à la base*) documenté
  (`runbook §2`). **OK au pilote** ; PgBouncer à introduire quand `max-scale × 5` approche ~70 %
  des connexions de l'instance.
- **Bus d'événements en mémoire (in-process)** — *les événements circulent dans le programme, pas
  dans un système de messagerie externe.* Ils sont **persistés** en base (table `DomainEvent`,
  append-only), mais le bus lui-même **n'est pas distribué** et ne survit pas à un redémarrage en
  vol. **OK au pilote** ; **à remplacer** par un vrai broker (type Kafka/NATS) pour des traitements
  asynchrones à l'échelle. **Quand** : quand on voudra du temps-réel inter-services.
- **Stockage des documents (coffre-fort)** — **⚠️ ERRATUM — CORRIGÉ PAR LE LOT 19.** À la
  rédaction, c'était le point le plus faible : les fichiers n'étaient stockés nulle part
  (`storageRef` placeholder). **Depuis le Lot 19**, le contenu est chiffré par tenant et écrit
  dans **Scaleway Object Storage** (bucket `rheos-documents-staging`) ; téléchargement contrôlé +
  intégrité + journalisation ; suppression réelle de l'objet. **Prouvé sur staging** (dépôt PDF →
  download → hash identique ; objet chiffré dans le bucket). Reste à surveiller à l'échelle : coût
  et débit Object Storage, cycle de vie/versioning, et suppression propagée aux **sauvegardes**.
- **Observabilité** — *capacité à voir ce qui se passe en production (métriques, traces, alertes).*
  **Promesse non tenue** : **pas d'OpenTelemetry**, pas de métriques applicatives, pas de traçage
  distribué. Il n'y a que `/health` + les logs bruts de la console Scaleway + un monitor uptime
  externe recommandé. **À faire** avant l'échelle : instrumentation (OTel), tableaux de bord, alertes.
- **Coûts d'inférence IA** — **nuls aujourd'hui** car **aucun modèle de langage n'est appelé**. Le
  jour où l'IA-native sera réelle, il faudra chiffrer coût + latence + confidentialité (envoyer des
  données RH à un LLM externe pose un enjeu RGPD majeur — plaide pour un modèle hébergé/UE). **Non
  estimable en l'état** faute d'implémentation.

**Synthèse scalabilité** : **OK jusqu'à ~quelques dizaines de tenants / quelques milliers de
collaborateurs** (pilote), sous réserve de relever le container. Pour la cible **250 clients /
1 M de collaborateurs**, il manque : **stockage documentaire réel**, base dimensionnée + réplicas
+ pooling, container horizontalement scalé, broker d'événements, **observabilité**, et surtout
**des tests de charge** pour transformer ces estimations en faits.

---

# 4. Écarts vs les 16 invariants du prompt maître

| Invariant | État | Nuance / où |
|---|---|---|
| **Person ≠ Employment** (personne distincte de l'emploi) | ✅ partout | réembauche = nouvel Employment (`test/d2-dossier.test.ts`) |
| **Multi-tenant + RLS** | ✅ avec nuance | RLS actif ; **`ENABLE` sans `FORCE`** (le rôle *propriétaire* contourne la RLS pour permettre `pg_dump`/restauration ; le rôle *applicatif* `rheos_app` reste, lui, pleinement isolé — prouvé `scripts/rls-check.mjs`). Décision documentée. |
| **Bitemporalité** (temps métier + temps de transaction) | ⚠️ partiel | `?asOf=` (temps métier) + événements horodatés (temps de transaction) ; pas de reconstruction bitemporelle *complète* |
| **Permissions atomiques** | ✅ | table rôle→permissions (`auth.ts`), `assertCan` côté service |
| **Deny by default** | ✅ | rien sans permission explicite (`test/security.test.ts`) |
| **Append-only / rien n'est écrasé** | ✅ | avenants, ledger congés, événements, archivage ; suppression contrôlée (rétention + legal hold) |
| **Créer ≠ valider ≠ signer** | ✅ | contrats/avenants/documents (prouvé staging : validate ≠ sign, DG seul signe) |
| **IA R0-R2 (propose, l'humain dispose)** | ✅ *sur le périmètre réel* | lecture seule, journalisée, anti-injection (`test/ai-cadree.test.ts`) — **mais l'IA n'est pas réelle** (règles) |
| **Aucune règle légale codée en dur** | ✅ | seuils/rétention/congés = données **datées** (`domain/*`) |
| **Audit des accès sensibles** | ✅ | écriture `AuditLog` (lecture IBAN/NIR, import, droit d'accès) |
| **Projections, jamais de base parallèle** | ✅ | RUP, Employee 360 recalculés |
| **Vocabulaire officiel (ADR-002)** | ✅ | `lint:vocab` vert en CI |
| **ABAC (périmètres)** | ⚠️ partiel | scopes présents dans le jeton et le moteur `inScope`, mais **beaucoup d'endpoints ne vérifient que la permission**, pas le périmètre ; jetons de démo sans périmètre lié |
| **Chiffrement des données sensibles** | ✅ | AES-256-GCM (NIR/IBAN) |
| **Séparation des secrets / hors code** | ✅ avec réserve | Secret Manager + GitHub Secrets ; **rotation manuelle**, pas de MFA |
| **Human-in-the-loop / traçabilité** | ✅ | événements + audit + validations humaines |

**Bilan invariants** : **13/16 pleinement respectés**, **3 partiels** (bitemporalité, ABAC,
et la nuance RLS NO FORCE — assumée). Aucun invariant *violé*.

---

# 5. Dette & risques connus, priorisés

**Bloquant-pilote** (à traiter avant même un vrai pilote client) :
- **Stockage documentaire absent** (coffre-fort sans fichiers). *Sans ça, on ne peut pas
  réellement conserver un contrat.* → brancher un stockage objet chiffré.
- **ACL réseau de la base ouverte `0.0.0.0/0`** en staging (le container a une IP dynamique).
  Acceptable en staging avec TLS + RLS + mots de passe forts, **à resserrer** (Private Network)
  avant d'héberger de vraies données.

**Bloquant-commercialisation** (avant de vendre / mettre en prod) :
- **Hypothèses juridiques ouvertes** (`docs/gaps.md`) : durées de rétention, seuils, bases
  légales, NIR — **à valider par un juriste** (les drafts CGU/DPA/politique du Lot 17 sont des
  premiers jets non validés).
- **Signature électronique** : aujourd'hui un OTP-stub, **pas une signature eIDAS réelle**.
- **Pas de haute disponibilité** : une seule base, pas de réplica → panne = interruption.
- **Pas d'observabilité** (métriques/traces/alertes) ni de **tests de charge**.
- **IA non réelle** : la promesse « OS RH cognitif » n'est pas tenue tant qu'aucun LLM n'est intégré
  (avec ses enjeux RGPD).
- **XLSX non supporté à l'import** (CSV uniquement) — mineur mais annoncé.

**Confort** (dette technique à solder progressivement) :
- **Rotation des secrets** manuelle ; pas de MFA.
- **ABAC** à appliquer systématiquement (périmètres) et à alimenter par un vrai SSO.
- **Avertissements CI Node 20** (fin de support approchant) — passer Node 22 LTS.
- Domaines D4-D9 à approfondir (moteurs métier réels).

---

# 6. Verdict final (10 lignes)

1. **Rhéos est un socle MVP réel, testé et déployé** — pas une maquette : 205 tests verts, un
   staging en ligne (`https://staging.rheos-corp.fr`) qui déroule le cycle RH de bout en bout.
2. Le **noyau (référentiel, dossier collaborateur, sensibles chiffrés, congés, intégrité
   documentaire, sécurité multi-tenant)** est **solide (~65-75 %)** et prouvé sur staging.
3. Les **domaines D4-D9 (paie, pilotage, santé, carrière, social, autorités)** sont **larges mais
   superficiels (~30 %)** : des structures, pas encore des moteurs.
4. **Ce qui est encore un prototype** : le pilotage, la santé, la carrière, le social — des CRUD.
5. **Ce qui n'existe pas encore** : le **stockage réel des documents**, la **signature eIDAS**,
   l'**IA réelle**, l'**observabilité**, la **haute disponibilité**, les **tests de charge**.
6. **Échelle** : dimensionné pour un **pilote** (dizaines de tenants), **très loin** des
   250 clients / 1 M de collaborateurs sans les chantiers ci-dessus.
7. **Conformité** : les invariants sont globalement respectés ; le RGPD est *outillé* mais *non
   validé juridiquement*.
8. **Couverture Book globale honnête : ~45-50 %** — un excellent P1/P2, pas un OS RH complet.

**Les 5 prochaines actions à plus forte valeur** :
1. **Brancher un stockage objet chiffré pour les documents** (débloque un vrai coffre-fort).
2. **Faire une recette pilote avec un vrai client** (passer des capacités de DÉPLOYÉ à VALIDÉ).
3. **Tests de charge + observabilité** (transformer les estimations d'échelle en faits).
4. **Validation juridique** des drafts RGPD + signature eIDAS réelle.
5. **Intégrer un premier LLM hébergé UE** sur le briefing/assistant (donner corps à l'« IA-native »).
