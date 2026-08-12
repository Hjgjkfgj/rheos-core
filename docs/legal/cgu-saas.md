# Conditions Générales d'Utilisation (CGU) — Rhéos SaaS

> **DRAFT — À FAIRE VALIDER PAR UN AVOCAT.** Premier jet adapté à l'architecture réelle
> (SaaS multi-tenant, hébergement Scaleway fr-par). Les champs entre crochets `[…]` et les
> mentions ⚖️ doivent être complétés/validés.

## 1. Objet
Les présentes CGU régissent l'accès et l'utilisation de la solution **Rhéos**, suite RH
SaaS (« le Service »), éditée par **[Rhéos — raison sociale, SIREN, siège]** (« l'Éditeur »),
par toute entreprise cliente (« le Client ») et ses utilisateurs habilités.

## 2. Description du Service
Rhéos fournit un outil de gestion administrative RH (référentiel entreprise, gestion des
collaborateurs, contrats, temps & absences, préparation des variables de paie, coffre-fort
documentaire, conformité). Le **calcul de la paie** est délégué à un partenaire certifié ;
Rhéos ne réalise pas d'acte de paie. Le Service est **multi-tenant** : les données de chaque
Client sont **strictement isolées** (Row-Level Security).

## 3. Accès & comptes
- Le Client désigne un administrateur qui gère les habilitations (rôles) de ses utilisateurs.
- Authentification par identifiant et mot de passe [+ ⚖️ MFA à préciser]. Les mots de passe
  sont stockés hachés (scrypt) ; l'Éditeur n'y a pas accès en clair.
- Le Client est responsable de la confidentialité des accès de ses utilisateurs.

## 4. Disponibilité & maintenance
- L'Éditeur met en œuvre les moyens pour assurer la disponibilité du Service. ⚖️ **SLA** (taux
  de disponibilité, fenêtres de maintenance, support) à définir en annexe / Contrat.
- Hébergement : **Scaleway SAS, région fr-par (France, UE)**.

## 5. Données du Client & protection des données
- Les données saisies restent la **propriété du Client**. L'Éditeur agit en **sous-traitant**
  au sens de l'art. 28 RGPD ; les modalités figurent au **DPA** (`docs/legal/dpa-client.md`),
  qui prévaut pour tout ce qui concerne les données personnelles.
- **Réversibilité** : le Client peut exporter ses données à tout moment (CSV/JSON). En fin de
  contrat, l'Éditeur restitue puis supprime les données selon le DPA. ⚖️ délais à préciser.
- **Sécurité** : chiffrement au repos des données sensibles (AES-256-GCM), TLS/HSTS, isolation
  RLS, journal d'audit, sauvegardes chiffrées (détail en annexe technique du DPA).

## 6. Obligations du Client
- Utiliser le Service conformément à la loi (droit du travail, RGPD) et informer ses
  collaborateurs du traitement de leurs données.
- Ne pas tenter de contourner les mesures de sécurité ni d'accéder aux données d'un autre tenant.
- Garantir l'exactitude des données saisies.

## 7. Propriété intellectuelle
Le Service, sa documentation et ses composants restent la propriété de l'Éditeur. Aucune
cession n'est consentie hors droit d'usage pour la durée du Contrat.

## 8. Responsabilité
- L'Éditeur est tenu d'une obligation de moyens. ⚖️ **Plafond de responsabilité, exclusions,
  force majeure** à définir par l'avocat.
- L'Éditeur ne saurait être responsable des décisions RH ou de paie prises par le Client à
  partir des données du Service.

## 9. Tarifs, durée, résiliation
⚖️ À définir (abonnement, durée, préavis, conséquences de la résiliation, sort des données).

## 10. Évolutions
L'Éditeur peut faire évoluer le Service et les présentes CGU ; le Client en est informé. ⚖️
préavis et modalités d'acceptation à préciser.

## 11. Droit applicable & litiges
Droit **français**. ⚖️ Tribunal compétent à préciser.

---
*Document DRAFT — non contractuel en l'état. À faire valider par un avocat avant toute diffusion.*
