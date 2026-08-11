# Import massif de collaborateurs — guide du pilote (Lot 16)

Ce guide accompagne le modèle **`modele-import-collaborateurs.csv`** (téléchargeable
depuis la console → **Import collaborateurs**). Objectif : injecter en une fois un lot
de collaborateurs, avec contrôle qualité **avant** écriture.

## Format du fichier
- **CSV** (encodage **UTF-8** recommandé ; Latin-1/windows-1252 accepté et détecté).
  Depuis Excel : *Fichier → Enregistrer sous → « CSV UTF-8 (délimité par des virgules) »*.
- Séparateur **`,`** ou **`;`** ou **tabulation** (détecté automatiquement).
- Une ligne d'**en-têtes** obligatoire, puis une ligne par collaborateur.
- `.xlsx` n'est pas pris en charge directement : enregistrez-le en CSV.

## Colonnes
| Colonne (en-tête) | Obligatoire | Format | Exemple |
|---|:---:|---|---|
| **Nom** | ✅ | texte | Dupont |
| **Prénom** | ✅ | texte | Marie |
| **Date de naissance** | — | `AAAA-MM-JJ` ou `JJ/MM/AAAA` | 1990-05-12 |
| **Date d'entrée** | ✅ | `AAAA-MM-JJ` ou `JJ/MM/AAAA` | 2026-01-06 |
| **Type de contrat** | ✅ | CDI, CDD, Apprentissage, Professionnalisation, Stage, Intérim, Saisonnier | CDI |
| **Rémunération brute mensuelle (€)** | — | nombre (`2100`, `1 900,50`) | 2100 |
| **Temps de travail (h/sem.)** | — | nombre | 35 |
| **SIRET établissement** | — | 14 chiffres (rattache à un établissement existant) | 55210055400013 |
| **Email personnel** | — | email | marie.dupont@example.fr |

> Les en-têtes sont **reconnus automatiquement** (mapping assisté) même avec des
> variantes (« Prénom », « first name », « salaire brut »…). Vous pouvez ajuster le
> mapping proposé avant de valider.

## Contrôles à l'import (rapport avant écriture)
Chaque ligne est classée :
- **À importer** — conforme, sera créée (cascade standard : Personne → Relation de
  travail → Contrat en brouillon `DRAFT`).
- **À vérifier** — anomalie non bloquante : doublon dans le fichier
  (nom + prénom + date de naissance), date incohérente (naissance dans le futur, âge à
  l'embauche < 16 ou > 90 ans, entrée > 2 ans dans le futur), SIRET d'établissement inconnu.
  **Non importée** tant qu'elle n'est pas corrigée.
- **Rejetée** — erreur bloquante : champ obligatoire manquant, date illisible, type de
  contrat inconnu, montant non numérique.
- **Déjà présent** — le collaborateur existe déjà dans le tenant → **ignoré** (voir idempotence).

Le rapport affiche par exemple : **« 982 importées, 12 à vérifier, 6 rejetées »**.

## Idempotence
Re-jouer **le même fichier** ne crée **aucun doublon** : un collaborateur déjà présent
(même nom + prénom + date de naissance) est ignoré. Vous pouvez donc relancer un import
sans risque après avoir corrigé quelques lignes.

## Traçabilité
Chaque import émet un **événement audité** (`CollaboratorsImported`) et une entrée au
**journal d'audit** (empreinte SHA-256 du fichier, compteurs importées/à vérifier/rejetées).

## Export miroir
La console permet d'**exporter** les collaborateurs du tenant en **CSV** ou **JSON**
(réversibilité et future portabilité RGPD).
