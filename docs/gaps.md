# Rhéos — Hypothèses & trous de spécification (à valider par un juriste)

> Chaque valeur légale du MVP est une **donnée de configuration datée** (invariant
> #6), jamais une constante métier codée en dur. Ce document liste les **hypothèses
> de seed** prises sur les trous de spécification connus. Elles sont **indicatives**
> et **doivent être validées par un juriste** avant mise en production. Aucune ne
> bloque l'architecture : changer une valeur = modifier un seed daté.

## 1. Durées de rétention documentaire (`src/domain/retention.ts`)

| Type | Durée retenue | Déclencheur | À valider |
|---|---|---|---|
| Bulletin de paie | 50 ans | dépôt | durée dématérialisée (déjà usuelle) |
| Contrat / avenant | 5 ans | fin de relation | point de départ (fin de contrat) |
| Pièce d'identité | 5 ans | fin de relation | conservation post-départ |
| Certificat / administratif | 5 ans | dépôt | — |

Mécanisme : `RetentionPolicy` (durée + événement déclencheur + legal hold). Le
**legal hold** bloque toute suppression, quelle que soit la durée. **À valider** :
durées exactes par type, cas de report (contentieux), purge automatique.

## 2. Seuils d'effectif & obligations (`src/domain/thresholds.ts`)

`ThresholdRule` **datées/versionnées** (effectiveFrom/effectiveTo, source légale).
Seed : 11 (CSE), 20 (règlement intérieur), 50 (CSE élargi, BDESE, participation),
250 (référent harcèlement employeur, index égalité). **À valider** : exhaustivité
des obligations par seuil, modalités de calcul de l'effectif (ETP, moyenne 12 mois),
dates d'entrée en vigueur.

## 3. Registre Unique du Personnel (`services.ts getRegistry`)

Généré **dynamiquement** depuis les données (jamais de base parallèle). Champs
exposés : nom, prénom, établissement (nom + SIRET), type de contrat, classification,
dates d'entrée/sortie, statut. **À valider** : liste exacte des mentions
obligatoires du RUP, ordre, format d'export légal (un registre par établissement).

## 4. Signature électronique — niveau eIDAS (`src/signature.ts`)

MVP : provider **OTP + scellement SHA-256** (`eidasLevel: "SIMPLE"`) derrière
l'interface `SignatureProvider`. **Décision ouverte** : niveau eIDAS requis
(avancée/qualifiée) par type d'acte. L'interface permet de brancher un prestataire
eIDAS **sans toucher aux services métier**. **À valider** : quels documents exigent
quel niveau ; valeur probante du certificat conservé.

## 5. Absences & congés (`src/domain/leave.ts`, spec `docs/spec-absences.md`)

Décisions **validées produit** (Aymeric) mais valeurs **à valider juriste** :
décompte **ouvrables 30 j/an** (2,5 j/mois), période de référence **1er juin →
31 mai**, report en fin de période = **perte** (sauf exceptions légales), calendrier
des **11 jours fériés** France. **À valider** : proratisation d'acquisition,
barème des **congés exceptionnels** (mariage, décès…), règles conventionnelles.

## 6. Extensions d'énumérations (non présentes dans les specs D1/D2 initiales)

Ajouts fonctionnels demandés, **à répercuter dans `rheos-specs-d1-d2/`** :
- `ObligationStatus += ARCHIVED` (cycle de vie obligation, Lot 2)
- `EmploymentStatus += ARCHIVED` (post-rétention, Lot 3)
- `DocumentStatus` (nouveau : DRAFT→…→ARCHIVED, Lot 4)
- `LeaveType += FAMILY_EVENT`, `LeaveStatus += MANAGER_APPROVED`, `LeaveLedgerKind` (Lot 5)
- `AiAuditLog` (journal IA, Lot 7)

## 7. Données sensibles non couvertes au MVP (rappel ADR-009)

Aucune **donnée médicale individuelle** (secret médical / HDS différé). Les
coordonnées bancaires (IBAN) et identifiants (NIR) sont **chiffrés au schéma**
(`ibanEnc`/`valueEnc`) ; le chemin de lecture restreint + audité reste à câbler
(sous-lot D2b, couplé au journal d'audit métier `AuditLog`).

---

## 8. Chiffrement des données sensibles (Lot 11)

`ibanEnc`/`valueEnc` (IBAN/NIR) sont chiffrés AES-256-GCM ; clé dérivée de
`ENCRYPTION_KEY` (env). **À décider avant prod** : gestion et **rotation** de la
clé (secret manager), stratégie de re-chiffrement. Ce n'est pas une hypothèse
juridique mais une décision opérationnelle ouverte.

## 9. Alignement specs↔code (Lot 12)

Les deltas des lots 2-11 ont été **répercutés dans `rheos-specs-d1-d2/`** (note de
version en tête de chaque fichier ; voir `docs/coherence-report.md`). **Cela ne
ferme AUCUNE des hypothèses juridiques ci-dessus** : rétention (§1), seuils (§2),
RUP (§3), eIDAS (§4), congés (§5) **restent ouvertes et à valider par un juriste**.
Extensions de schéma actées (enums ARCHIVED, DocumentStatus, ChangeRequest,
AuditLog.reason, correctif UserRole) — techniques, sans portée juridique.

## 10. Conformité P3 — de « hypothèse » à « draft prêt pour validation » (Lot 17)

Le Lot 17 **matérialise** les hypothèses en **documents relisibles par un avocat** et en
**mécanismes exécutables**. Ce qui change de statut :

| Sujet | Avant (hypothèse) | Après Lot 17 (draft prêt à valider) |
|---|---|---|
| Cartographie des traitements | implicite (dans le code) | **`docs/rgpd/registre-traitements.md`** généré du modèle réel, champs ⚖️ marqués |
| Analyse d'impact | absente | **`docs/rgpd/aipd-dossier-collaborateur.md`** pré-remplie (archi réelle + questions ⚖️) |
| Droit d'accès (art. 15) | non outillé | **endpoint + procédure** : export PDF+JSON journalisé (`/persons/:id/access-request`) |
| Effacement/anonymisation (art. 17) | mécanique documents seule | **commande exécutable et testée** (`npm run anonymize`) branchée sur DELETE/ANONYMIZE/ARCHIVE |
| CGU / DPA / politique | inexistants | **drafts FR** (`docs/legal/*.md`) marqués *DRAFT — À FAIRE VALIDER PAR UN AVOCAT* |
| Information des personnes | aucune page | page **`/confidentialite`** en ligne + mention **« aucun traceur »** |

**Reste OUVERT (⚖️ juriste)** : bases légales exactes (dont NIR), durées de conservation
précises (§1), qualification responsable/sous-traitant par module, délai de purge des
**sauvegardes** vs droit à l'effacement, SLA et clauses de responsabilité des CGU. Ces points
sont **listés explicitement** dans chaque document (mentions ⚖️).

---

**Statut** : hypothèses de travail, **non validées juridiquement**. Aucune ne fige
l'architecture — toutes sont des données datées modifiables sans redéploiement de code.
**Les hypothèses §1-§5 demeurent OUVERTES** (à valider juriste) ; le Lot 17 les a
**transformées en drafts prêts pour la revue juridique** (§10).
