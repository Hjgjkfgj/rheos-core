# AIPD — Dossier collaborateur Rhéos (trame pré-remplie)

> **DRAFT — à compléter et valider par le DPO / juriste.** Analyse d'Impact relative à la
> Protection des Données (RGPD art. 35). Trame **pré-remplie avec l'architecture réelle** ;
> les **questions ouvertes** (⚖️) attendent la décision juridique. Méthodologie CNIL.

## 0. Le traitement nécessite-t-il une AIPD ?
Le dossier collaborateur traite des **données sensibles / à risque** (NIR, coordonnées
bancaires) à **grande échelle** (multi-tenant SaaS) → une AIPD est **recommandée**. ⚖️ confirmer.

## 1. Description du traitement
- **Finalité générale** : gestion administrative du personnel (embauche → carrière → sortie),
  paie (préparation des variables ; calcul délégué à un partenaire certifié), conformité.
- **Nature** : SaaS multi-tenant ; l'entreprise cliente est **responsable de traitement**,
  Rhéos **sous-traitant** (art. 28). ⚖️ confirmer par module.
- **Données** (modèle réel) : identité, contrats/carrière, temps/absences, **NIR & IBAN
  (chiffrés)**, documents (coffre-fort), journaux. Détail : `registre-traitements.md`.
- **Supports & flux** :
  - Application (Serverless Container Scaleway fr-par) ↔ base **PostgreSQL managée** (fr-par).
  - **Chiffrement en transit** TLS ; **au repos** AES-256-GCM pour NIR/IBAN.
  - Sauvegardes chiffrées AES-256 → Object Storage (fr-par).
  - **Aucun transfert hors UE** identifié.
- **Durées** : politique de rétention datée par type (bulletins 50 ans, contrats 5 ans post-relation…). ⚖️ à valider.

## 2. Nécessité & proportionnalité
- **Base légale** : exécution du contrat / obligation légale / intérêt légitime selon la donnée. ⚖️ à qualifier précisément.
- **Minimisation** : données limitées au besoin RH ; le **contenu documentaire n'est pas stocké en base** (seule l'empreinte SHA-256). ⚖️ vérifier l'absence de champs superflus.
- **Qualité & exactitude** : demandes de changement self-service validées par le RH (`ChangeRequest`).
- **Durées** : rétention configurée + legal hold + anonymisation en fin de vie. ⚖️ durées exactes.
- **Information & droits** : politique de confidentialité (`/confidentialite`) ; droit d'accès (export PDF/JSON journalisé) ; anonymisation. ⚖️ modalités d'information des personnes.

## 3. Risques pour les personnes & mesures
| Risque | Impact potentiel | Mesures réelles | Résiduel |
|---|---|---|---|
| **Accès illégitime** (autre tenant, rôle non habilité) | divulgation NIR/IBAN | **RLS** (isolation base), RBAC+ABAC deny-by-default, rôle non-superutilisateur, chiffrement au repos, audit des accès sensibles | ⚖️ à coter |
| **Accès illégitime** (attaquant externe) | fuite de données | TLS/HSTS, secrets externalisés, sauvegardes chiffrées, mots de passe hachés (scrypt) | ⚖️ à coter |
| **Modification non désirée** | données erronées | événements append-only, journal d'audit, workflow de validation (contrats, change requests) | ⚖️ à coter |
| **Disparition** | perte de données | sauvegardes chiffrées quotidiennes + **PITR 7 j** + **restauration testée** | ⚖️ à coter |
| **Conservation excessive** | atteinte à la minimisation | rétention datée + anonymisation exécutable et testée | ⚖️ durées à valider |

## 4. Points de vigilance spécifiques (⚖️ décisions juridiques)
1. **NIR** : fondement précis, périmètre d'usage, éventuelle restriction d'accès renforcée.
2. **Sauvegardes** : les dumps chiffrés contiennent le NIR/IBAN chiffrés — vérifier la durée de conservation des sauvegardes vs droit à l'effacement (ré-anonymisation impossible dans un dump figé → documenter le délai de purge des sauvegardes).
3. **Sous-traitance ultérieure** (Scaleway) : contrat art. 28 en place ? clause de sous-traitance ultérieure ?
4. **ACL base ouverte (staging)** : en staging, l'ACL réseau de la base est ouverte (le container a une IP dynamique) — acceptable avec TLS + auth forte + RLS, **à resserrer en production** (Private Network). ⚖️ décision.
5. **Journaux** : durée de conservation des logs d'audit (proportionnalité).

## 5. Avis & validation
- **Avis du DPO** : ⚖️ *à rendre*.
- **Position du responsable de traitement (client)** : ⚖️ *à recueillir*.
- **Consultation CNIL** : requise seulement si risque résiduel élevé non maîtrisé. ⚖️ à évaluer.
