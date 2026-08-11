# Accord de traitement des données (DPA) — Rhéos ↔ Client

> **DRAFT — À FAIRE VALIDER PAR UN AVOCAT.** Contrat de sous-traitance au sens de
> l'**art. 28 RGPD**, adapté à l'architecture réelle (hébergement Scaleway fr-par,
> mesures techniques en annexe). Champs `[…]` et mentions ⚖️ à compléter.

## 1. Parties & rôles
- **Responsable de traitement** : le Client (« l'Entreprise »).
- **Sous-traitant** : **[Rhéos — raison sociale, SIREN]** (« l'Éditeur »).
- **Sous-traitant ultérieur** : **Scaleway SAS** (hébergement), région **fr-par (France, UE)**.

L'Éditeur traite les données personnelles **uniquement sur instruction documentée** du
Responsable et pour les finalités du Service (gestion RH).

## 2. Objet, durée, nature & finalité
- **Objet** : hébergement et traitement des données RH via le Service Rhéos.
- **Durée** : durée du Contrat principal.
- **Nature des opérations** : collecte, enregistrement, organisation, conservation,
  consultation, export, anonymisation, suppression.
- **Finalités** : voir `docs/rgpd/registre-traitements.md`.

## 3. Catégories de données & de personnes
- **Personnes** : collaborateurs (et candidats/anciens collaborateurs) de l'Entreprise.
- **Données** : identité, contrats/carrière, temps & absences, **NIR & coordonnées bancaires
  (chiffrés)**, documents, journaux. Détail : registre des traitements.

## 4. Obligations de l'Éditeur (art. 28.3)
1. Traiter les données **sur instruction** du Responsable uniquement.
2. Garantir la **confidentialité** (personnel habilité, engagements de confidentialité).
3. Mettre en œuvre les **mesures de sécurité** de l'**Annexe 2** (art. 32).
4. Respecter les conditions de **sous-traitance ultérieure** (§5).
5. **Assister** le Responsable pour les demandes des personnes (droits d'accès, rectification,
   effacement — outils dédiés fournis) et pour ses obligations (sécurité, notification de
   violation, AIPD).
6. **Notifier toute violation** de données sans délai injustifié [⚖️ délai à préciser, ex. 48 h].
7. Au choix du Responsable, **supprimer ou restituer** les données en fin de Contrat, et
   supprimer les copies (sous réserve des obligations légales de conservation). ⚖️ délais.
8. Tenir à disposition la **documentation** prouvant la conformité et permettre des **audits**
   [⚖️ modalités, fréquence].

## 5. Sous-traitance ultérieure
- L'Éditeur est autorisé à recourir à **Scaleway SAS** (hébergement, fr-par).
- Toute nouvelle sous-traitance ultérieure fait l'objet d'une **information préalable** du
  Responsable, qui peut s'y opposer. ⚖️ modalités.
- Les sous-traitants ultérieurs sont soumis aux **mêmes obligations** (art. 28.4).

## 6. Transferts hors UE
**Aucun transfert hors UE** à ce jour (hébergement France). Tout transfert futur serait encadré
(décision d'adéquation ou garanties appropriées, art. 46). ⚖️ à maintenir à jour.

## 7. Violation de données
Procédure : détection → qualification → **notification au Responsable** → assistance à la
notification CNIL (art. 33) et aux personnes (art. 34) le cas échéant. ⚖️ délais/format.

## Annexe 1 — Liste des sous-traitants ultérieurs
| Sous-traitant | Rôle | Localisation | Garanties |
|---|---|---|---|
| Scaleway SAS | Hébergement (app, base PostgreSQL, sauvegardes) | fr-par (France, UE) | ⚖️ DPA Scaleway à annexer |

## Annexe 2 — Mesures techniques et organisationnelles (art. 32) — **réelles**
| Domaine | Mesure |
|---|---|
| Chiffrement au repos | AES-256-GCM pour NIR & IBAN (`src/crypto.ts`) |
| Chiffrement en transit | TLS obligatoire, redirection HTTPS, HSTS |
| Cloisonnement | Row-Level Security PostgreSQL (isolation multi-tenant), rôle applicatif non-superutilisateur `NOBYPASSRLS` |
| Contrôle d'accès | RBAC (permissions atomiques) + ABAC (périmètres), *deny by default* |
| Traçabilité | Journal d'audit ; accès sensibles tracés ; événements append-only |
| Sauvegarde/continuité | `pg_dump` chiffré AES-256 → Object Storage ; **PITR 7 j** ; **restauration testée** |
| Gestion des secrets | Secret Manager ; aucun secret en clair dans le code ; `ENCRYPTION_KEY` externalisée + rotation documentée |
| Authentification | Mots de passe hachés (scrypt) ; jetons signés ; [⚖️ MFA] |
| Minimisation | Contenu documentaire non stocké en base (empreinte SHA-256 seule) |

---
*Document DRAFT — À faire valider par un avocat. Ne pas signer en l'état.*
