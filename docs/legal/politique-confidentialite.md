# Politique de confidentialité — Rhéos

> **DRAFT — À FAIRE VALIDER PAR UN AVOCAT.** Version source de la page publiée sur
> **`/confidentialite`** (`web/confidentialite.html`). Adaptée à l'architecture réelle
> (hébergement Scaleway fr-par, aucun traceur). Mentions ⚖️ à confirmer.

## 1. Responsable / sous-traitant
L'entreprise cliente est **responsable de traitement** ; Rhéos agit en **sous-traitant**
(art. 28 RGPD), selon le DPA. **DPO** : dpo@rheos-corp.fr ⚖️.

## 2. Données traitées & finalités
| Catégorie | Exemples | Finalité | Base légale (probable ⚖️) |
|---|---|---|---|
| Identité | nom, prénom, naissance, email | gestion administrative RH | contrat / obligation légale |
| Contrats & carrière | contrats, avenants, affectations, compétences | gestion de la relation de travail | contrat / obligation légale |
| Temps & absences | plannings, pointages, congés | suivi du temps de travail | obligation légale / intérêt légitime |
| Données sensibles | NIR, IBAN | paie, déclarations sociales | obligation légale |
| Documents | contrats signés, justificatifs | conservation probante | obligation légale / intérêt légitime |

Détail : `docs/rgpd/registre-traitements.md`.

## 3. Destinataires & sous-traitants
Données **non vendues**. Accès : service RH habilité (employeur) ; **Scaleway SAS**
(hébergement, **fr-par, France, UE**). **Aucun transfert hors UE** identifié.

## 4. Durées de conservation
Configurées par type (ex. bulletins 50 ans, contrats 5 ans après la relation) ; **legal hold**
possible ; **anonymisation** en fin de rétention. Durées exactes ⚖️ (voir `docs/gaps.md`).

## 5. Sécurité (mesures réelles)
Chiffrement au repos (AES-256-GCM : NIR/IBAN), isolation multi-tenant (RLS PostgreSQL),
TLS/HSTS, journal d'audit, sauvegardes chiffrées + restauration testée, rôle applicatif
non-superutilisateur, secrets externalisés.

## 6. Vos droits
Accès, rectification, effacement, limitation, opposition, portabilité. Outils : **export
« droit d'accès »** (PDF + JSON, journalisé) et **anonymisation**. Exercice via le service RH
ou le DPO. Réclamation possible auprès de la **CNIL**.

## 7. Cookies & traceurs
**Aucun traceur publicitaire ni cookie tiers** (pas d'analytics, pixel, cookie de suivi).
Seul un **jeton de session** strictement nécessaire à l'authentification est utilisé — il ne
trace pas la navigation. **Aucune bannière cookie requise.**

## 8. Mentions légales
Éditeur : Rhéos ⚖️ (raison sociale, SIREN, directeur de publication). Hébergeur : Scaleway SAS,
8 rue de la Ville l'Évêque, 75008 Paris, fr-par. Contact : contact@rheos-corp.fr ⚖️.

---
*DRAFT — à faire valider par un avocat.*
