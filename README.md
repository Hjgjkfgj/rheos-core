# rheos-core

Noyau applicatif de **Rhéos** — implémentation exécutable et testée des domaines
**D1 (Entreprise & Référentiel)** et **D2 (Gestion administrative & dossier)**,
générée à partir de `rheos-specs-d1-d2`.

## État

- ✅ **19 tests verts** (`npm test`) reproduisant les scénarios Gherkin.
- **D1 + D2** : isolation multi-tenant, embauche en cascade, séparation
  création/signature, requête temporelle (`employee360?asOf=`), historisation
  des affectations, détection de doublon, sortie, Registre Unique du Personnel.
- **D1 — Effectif / seuils / obligations** : calcul d'effectif, franchissement
  de seuils (11/20/50/250) déclenchant les obligations correspondantes
  (idempotent, événements `WorkforceThresholdCrossed`/`ObligationTriggered`),
  et **simulation** proactive « et si j'embauche N ? » (sandbox, sans écriture).
- **D10 — Coffre-fort** : dépôt scellé SHA-256 (WORM), workflow de signature
  (demande → signature par un signataire, certificat de preuve), contrôle
  d'intégrité, droits (dépôt ≠ signature ≠ lecture).
- **D3 — Temps** : congés (demande/approbation, soldes) **+ planning & pointage**
  (shifts prévus, pointage réel, synthèse d'écart prévu/réalisé) ; les heures
  travaillées alimentent les variables de paie (heures supplémentaires calculées).
- **Auth JWT** : login (scrypt) → jeton Bearer HS256 ; jetons falsifiés/expirés rejetés.
- **Moteurs métier** : convention collective **datée** (valeur du point effective-dated,
  minimum conventionnel par coefficient ; refus d'une rémunération sous le minimum
  à l'embauche), **rétention RGPD** (durée légale par type au dépôt — bulletin 50 ans)
  et **extraction documentaire** (`POST /extract` : email, téléphone, IBAN, NIR, code
  postal, date de naissance — avec neutralisation IBAN/NIR avant le téléphone).
- **D4 — Préparation des variables de paie** : agrégation base contrat + congés/absences
  par période (overlap), ancienneté, jours non rémunérés, lot d'entreprise. **Aucun calcul
  de paie** — brut→net et DSN délégués à un moteur certifié (ADR-008).
- **Centre de notifications** (`GET /notifications`) : vue priorisée (CRITICAL/IMPORTANT/
  ACTION/INFO) des actions en attente — obligations, contrats & documents à signer,
  congés à valider, sorties à préparer — scopée au tenant.
- **Digital RH Officer** (`GET /rh-officer/briefing`) : briefing quotidien déterministe
  (fil narratif + effectif/distance au prochain seuil + activité du jour + recommandations),
  explicable et reformulable par une couche LLM sans altérer les faits (ADR-010).
- **Organigramme** (`GET /companies/:id/org-chart`) : arbre hiérarchique depuis les
  affectations (managerEmploymentId), directeur/PDG en racine.
- **Avenants** : créer → signer (rôle signataire) → application au contrat, avenant
  conservé comme historique (`POST /contracts/:id/amendments`, `POST /amendments/:id/sign`).
- **Veille & échéances** (`GET /companies/:id/deadlines`) : fins de CDD, sorties,
  deadlines d'obligations + échéances personnalisées (visite médicale, habilitation),
  avec statut (en retard / bientôt / à venir) et alimentation du centre de notifications.
- **D8 — Dialogue social / IRP (CSE)** : mandats des élus (titulaire, secrétaire,
  référent harcèlement…) et réunions (ordre du jour, statut, PV) — `.../cse/mandates`,
  `.../cse/meetings`, `/cse/meetings/:id/minutes`.
- **D9 — Institutions & Pouvoirs publics** : suivi des interactions autorités
  (Inspection du travail, URSSAF, CARSAT…) — contrôles, demandes, déclarations ;
  la date limite de réponse crée une échéance de veille. `.../authority/interactions`,
  `/authority/interactions/:id/respond|close`.
- **D6 — Santé, Sécurité & Prévention** : DUERP (registre des risques coté
  gravité×probabilité → niveau, plan d'actions) + accidents du travail (accident
  grave → échéance de déclaration). `.../risks`, `.../duerp`, `.../accidents`.
  Aucune donnée médicale individuelle (secret médical / HDS — ADR-009).
- **D7 — Carrière, Compétences & Formation** : compétences/habilitations (expiration
  → habilitation en veille), formations (planifiées/réalisées, échéance → veille),
  entretiens (annuel/professionnel). `.../competencies`, `.../trainings`, `.../reviews`.
- **D5 — Pilotage économique & financier** : masse salariale, coût employeur
  (charges indicatives), budget vs réel (écart), atterrissage, simulateur de coûts.
  Consomme les données des autres domaines (n'en possède aucune). `.../pilotage`,
  `.../budgets`, `.../pilotage/cost-simulate`.
- Store **en mémoire** scopé par tenant (simule la Row-Level Security). Cible de
  production : Prisma/PostgreSQL (`../rheos-specs-d1-d2/prisma/schema.prisma`) via
  le pattern Repository (ADR-014) — on remplace l'implémentation du store sans
  toucher aux services.

## Persistance (port Repository, ADR-014)

Les services dépendent d'une interface `Repository`, jamais d'une base concrète.
Deux implémentations interchangeables via la variable `STORE` :

- `STORE=memory` (défaut) — `MemoryRepository`, pour dev/tests (scopé tenant).
- `STORE=prisma` — `PrismaRepository`, PostgreSQL + **Row-Level Security**.

### Passer en base réelle (Postgres + RLS) — 3 commandes

Prérequis : Docker + Node.

```bash
cp .env.example .env          # ajuste si besoin
npm install                   # installe aussi Prisma + @prisma/client
npm run db:up                 # démarre PostgreSQL (docker compose)
npm run db:setup              # rôle applicatif + schéma (prisma db push) + RLS
STORE=prisma npm start        # API + console sur http://localhost:3000
```

`db:setup` (script `scripts/db-setup.sh`) crée un rôle **non-superutilisateur**
`rheos_app` (indispensable pour que la RLS s'applique), pousse le schéma et
exécute `prisma/migrations/0001_init/rls.sql`. Au runtime, l'app utilise
`DATABASE_URL` (rôle rheos_app) et pose `SET LOCAL app.tenant_id` par transaction.

Aucune ligne des **services** n'est modifiée pour passer de mémoire à Prisma
(port Repository, ADR-014). Les mêmes flux testés en mémoire tournent alors en base.

> Le `PrismaRepository` convertit automatiquement les dates « YYYY-MM-DD » en
> DateTime. Point de vigilance : ne jamais lancer l'app avec l'utilisateur
> `postgres` (superutilisateur), qui contourne la RLS — utiliser `rheos_app`.

## Démarrer

```bash
npm install
npm test          # 50 tests Vitest
npm run dev       # API + console sur http://localhost:3000 (STORE=memory)
```

## Espace collaborateur (démo ludique)

Ouvre **http://localhost:3000/espace** : une petite app simple et ludique côté
collaborateur (progression d'intégration, mon contrat, mes documents, mes congés
avec solde, mon planning + pointage). Bouton « Découvrir mon espace (démo) » qui
prépare un collaborateur d'exemple et ouvre SON espace. Toutes les données sont
résolues depuis le jeton (`/api/v1/me*`) : un collaborateur ne voit que lui-même.

## Console de contrôle (démo)

Ouvre **http://localhost:3000** après `npm run dev` : une page mono-fichier servie
par le serveur lui-même (même origine, pas de CORS) permet de piloter tout le
cycle — connexion (admin/rh/dg), création société/établissement, embauche (avec
convention datée), signature de contrat, coffre-fort + signature, congés,
effectif/obligations, simulation, notifications et **briefing Digital RH Officer**.
Chaque appel et sa réponse s'affichent dans le journal.

## Appeler l'API (authentification JWT)

Login → jeton Bearer (HS256). Le tenant, l'utilisateur et les rôles sont portés
par le jeton signé (jamais par un paramètre). Utilisateurs de démo : `rh@acme`,
`dg@acme`, `admin@acme` (mot de passe `secret`).

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"rh@acme","password":"secret"}' | jq -r .token)

curl -X POST localhost:3000/api/v1/companies \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"legalName":"ACME SAS","siren":"552100554"}'
```

Secret via `JWT_SECRET` (défaut dev). En production : secret fort + vérification
au niveau de l'API Gateway (ADR-006).

## Structure

```
src/
  types.ts      Types (miroir du schema.prisma, ADR-002 anglais)
  store.ts      Store en mémoire scopé tenant (cible : Prisma)
  events.ts     Event bus + journal DomainEvent (append-only, ADR-004/005)
  auth.ts       RBAC (rôles → permissions atomiques) + ABAC minimal
  services.ts   Logique métier D1 + D2 (déterministe, événements publiés)
  app.ts        Routes Fastify /api/v1 + auth + gestion d'erreurs
  server.ts     Point d'entrée
test/           Scénarios exécutables (Gherkin → Vitest)
```

## Prochaines briques (P1 → P2)

- Brancher le `PrismaRepository` (schema.prisma) + activer la RLS PostgreSQL.
- JWT réel (API Gateway) à la place de l'en-tête simulé.
- Coffre-fort D10 complet (signature, scellement WORM) + socle Temps (D3).
- Câbler les moteurs existants (rétention RGPD, convention datée, extraction).
