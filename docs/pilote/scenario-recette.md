# Recette pilote Rhéos — déroulé client (répétition générale)

> **But** : tu joues le **client pilote**. Tu exécutes ce scénario **toi-même, sur staging,
> sans l'aide du développeur**, et tu **notes chaque friction** dans
> `docs/pilote/feedback.md` (date / étape / problème / criticité). C'est la répétition
> générale avant un vrai client.
>
> **Environnement** : https://staging.rheos-corp.fr — **tenant neuf `PILOTE`** (vide, rien à
> voir avec la vitrine DEMO). Durée estimée : **20–30 min**.

## Accès (à garder sous la main)
| Rôle | Email | Mot de passe | Sert à |
|---|---|---|---|
| Administrateur RH | `admin@pilote` | `pilote2026` | créer l'entreprise, importer, embaucher, valider |
| Direction (signataire) | `dg@pilote` | `pilote2026` | **signer** les contrats (séparation des droits) |

Fichier fourni pour l'import : **`docs/pilote/collaborateurs-pilote.csv`** (30 collaborateurs).

> **Comment se connecter** : sur https://staging.rheos-corp.fr, en haut à droite, saisis
> l'email + le mot de passe dans les deux champs, puis **« Se connecter »**. Le bandeau doit
> afficher « connecté : admin@pilote ». (Ignore les boutons *Admin/RH/DG* : ce sont des
> raccourks d'un autre tenant.)

---

## Étape 0 — Connexion (admin RH)
1. Ouvre https://staging.rheos-corp.fr.
2. Connecte-toi avec **`admin@pilote` / `pilote2026`**.
- **Ce que tu dois voir** : en haut à droite, « connecté : admin@pilote ».
- ✅ **Réussi si** : tu es connecté (aucune erreur rouge).

## Étape 1 — Créer l'entreprise et un établissement
1. Menu gauche → **🏢 Entreprise & Référentiel → Créer une société**.
2. Raison sociale : `Boulangerie Pilote SAS` — SIREN : `552100554` → **Créer la société**.
3. Menu → **Ajouter un établissement** : SIRET `55210055400013`, Nom `Fournil Central`, IDCC `2216` → **Créer l'établissement**.
- **Ce que tu dois voir** : deux messages « Société créée ✓ » puis « Établissement créé ✓ », avec les identifiants renvoyés.
- ✅ **Réussi si** : les deux créations réussissent sans erreur.

## Étape 2 — Importer 30 collaborateurs (CSV)
1. Menu → **📥 Import / Export → Importer des collaborateurs**.
2. **Entreprise cible** : `Boulangerie Pilote SAS`.
3. **Fichier CSV** : choisis `docs/pilote/collaborateurs-pilote.csv`.
4. Clique **Prévisualiser**.
- **Ce que tu dois voir** : un rapport « **30 importées, 0 à vérifier, 0 rejetées — 30 lignes** » (préversion, rien n'est encore écrit) + un tableau des 30 lignes en « ✅ à importer ».
5. Clique **Confirmer l'import (30 ligne(s))**.
- **Ce que tu dois voir** : le rapport passe à « **30 importées** ».
- ✅ **Réussi si** : 30 importées, 0 rejetée.
6. *(Bonus idempotence)* Refais **Prévisualiser** avec le même fichier.
- **Ce que tu dois voir** : « 0 importées, … , **30 déjà présentes** » — le re-jeu **ne crée pas de doublon**.

## Étape 3 — Embauche complète → contrat signé → coffre-fort (avec retéléchargement)
1. Menu → **🗂️ Gestion administrative → Éditer une embauche**.
2. Nom `Martin`, Prénom `Julie`, Date d'entrée `2026-06-15`, Type `CDI`, Brut `2400`, Coefficient `110` → **Embaucher**.
- **Ce que tu dois voir** : « Embauche réalisée ✓ », statut relation **PRE_HIRE**, contrat **DRAFT** (brouillon).
3. Menu → **Signer le contrat**. *(Le RH ne peut pas signer — c'est voulu.)* **Connecte-toi en `dg@pilote` / `pilote2026`** (en haut), puis reviens sur **Signer le contrat** → **Signer**.
- **Ce que tu dois voir** : le contrat passe à **ACTIVE**. *(La séparation « qui valide ≠ qui signe » est un point de conformité clé.)*
4. Re-connecte-toi en **`admin@pilote`**. Menu → **🔒 Coffre-fort documentaire → Déposer un document** : Libellé `Contrat de travail signé`, Type `CONTRACT`, **choisis un fichier PDF** de ton ordinateur → **Déposer**.
- **Ce que tu dois voir** : « Document déposé ✓ » avec une **empreinte** (SHA-256) et une **taille** en octets.
5. Menu → **Mes documents** → sur la ligne du contrat, clique **Télécharger**.
- **Ce que tu dois voir** : le **PDF se télécharge** et s'ouvre — **c'est exactement le fichier déposé** (le contenu est réellement stocké, chiffré, et vérifié à l'intégrité au téléchargement).
- ✅ **Réussi si** : contrat ACTIVE **et** le PDF retéléchargé est identique à celui déposé.

## Étape 4 — Poser et valider un congé
1. Menu → **⏱️ Temps & Activité → Demander un congé** : Début `2026-08-10`, Fin `2026-08-14` → **Demander**.
- **Ce que tu dois voir** : « Congé demandé ✓ », un nombre de **jours** décomptés et le statut **REQUESTED**.
2. Menu → **Valider un congé** → **Approuver**.
- **Ce que tu dois voir** : statut **APPROVED** (ou MANAGER_APPROVED selon le circuit).
- ✅ **Réussi si** : le congé est demandé puis validé, avec un nombre de jours cohérent.

## Étape 5 — Consulter le Registre Unique du Personnel (RUP)
1. Menu → **🗂️ Gestion administrative → Registre du personnel**.
- **Ce que tu dois voir** : un **registre listant les 31 collaborateurs** (30 importés + Julie Martin), avec nom, établissement, type de contrat, date d'entrée.
- ✅ **Réussi si** : le registre reflète tout le monde, dans l'ordre d'entrée (c'est calculé à la volée, jamais tenu en double).

## Étape 6 — Espace collaborateur (PWA) : « je ne vois que moi »
1. Menu → **🗂️ Gestion administrative → Lien d'accès collaborateur** → **Générer le lien**.
- **Ce que tu dois voir** : un **lien** `https://staging.rheos-corp.fr/espace#token=…` (l'accès de Julie Martin).
2. Clique **Ouvrir l'espace ↗** (ou copie le lien dans un nouvel onglet, idéalement sur ton **téléphone**).
- **Ce que tu dois voir** : l'**espace personnel** de Julie Martin (« Bonjour Julie 👋 »), son contrat, ses documents, ses congés — **et RIEN sur les autres collaborateurs**.
3. *(Sur mobile)* Menu du navigateur → **« Ajouter à l'écran d'accueil »**.
- **Ce que tu dois voir** : l'app s'installe comme une application (icône Rhéos).
- ✅ **Réussi si** : tu ne vois **que** les données de Julie, et l'app est **installable** sur mobile.

## Étape 7 — Droit d'accès : exporter le dossier d'une personne (RGPD)
1. Reviens sur la console (connecté `admin@pilote`).
2. Menu → **🗂️ Gestion administrative → Lien d'accès collaborateur** → **Exporter le dossier (PDF)**
   *(le collaborateur courant est Julie Martin, ta dernière embauche)*.
- **Ce que tu dois voir** : un **PDF se télécharge** récapitulant toutes les données de la personne
  (identité, contrats, congés, documents) — les **valeurs sensibles (IBAN/NIR) sont masquées**.
- ✅ **Réussi si** : le PDF « droit d'accès » se télécharge et contient bien les données de Julie.

---

## Comment noter tes retours
Ouvre **`docs/pilote/feedback.md`** et, pour **chaque** friction, incompréhension ou bug,
ajoute une ligne : **date · étape · ce qui s'est passé / ce que tu attendais · criticité**
(bloquant / gênant / cosmétique / idée). Sois franc : chaque irritant noté = un point
d'amélioration. Ne me préviens pas pendant — c'est **toi** qui déroules ; on triera après.
