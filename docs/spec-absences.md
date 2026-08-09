# Rhéos — Mini-spec « Socle Temps : absences, congés, compteurs » (Lot 5, étape 1)

> **Statut : VALIDÉE par Aymeric (2026-08-09) — décisions ci-dessous. Valeurs légales toujours « à valider juriste ».**
>
> **Décisions validées (étape 1)** :
> 1. **Décompte par défaut : ouvrables** (30 j/an, 2,5 j ouvrables/mois).
> 2. **Étape RH conditionnelle** (`LeaveApprovalPolicy.requiresHr`) : manager suffit par défaut.
> 3. **Période de référence : légale 1er juin → 31 mai** (surchargeable).
> 4. **Report en fin de période : perte** au terme (sauf exceptions légales : maladie, maternité…).
>
> **Statut initial : PROPOSITION — à valider par Aymeric (et un juriste pour les valeurs légales) avant implémentation.**
> Protocole « trou de spec » (Tomes 08/09 se renvoient la responsabilité) : on
> rédige d'abord, on fait valider, puis on code. Aucune valeur légale n'est
> codée en dur : tout est **configuration datée** (`effectiveFrom`/`effectiveTo`,
> source), seed marqué « à valider juriste ».

## 1. Objectif & périmètre

Gérer les **absences** et **congés** d'un collaborateur : demande → validation →
mise à jour des **compteurs/soldes** → consommation par le **planning simple** et
la **préparation des variables de paie** (jours non rémunérés). Périmètre MVP :
CP, maladie, sans solde, congés exceptionnels. Hors périmètre : calcul de paie
(délégué, ADR-008), planning optimisé.

**Existant réutilisé** (ne pas réinventer) : `LeaveRequest`, `leaveBalance`,
`decideLeave`, event bus, `Agreement` (convention datée, Lot 2), préparation paie
(`buildPayrollInput`). **À sortir** : les allocations codées en dur
(`DEFAULT_ALLOWANCE` dans `services-mvp.ts`) → configuration datée.

## 2. Principe directeur — aucune règle légale en dur (invariant #6)

Toute valeur (droit annuel, taux d'acquisition, période de référence, jours
fériés, délais, motifs conventionnels…) vit dans des **entités de configuration
datées**, jamais dans le code. Le code applique la règle **en vigueur à la date
d'effet** de l'absence (comme la convention datée du Lot 2).

## 3. Types d'absence (`AbsenceType`, configurable/daté)

Table de configuration `LeaveTypePolicy` (seed « à valider juriste ») :

| code | libellé | rémunéré | décompté du solde | pièce justificative | acquisition |
|---|---|---|---|---|---|
| `PAID` (CP) | Congés payés | oui | oui (solde CP) | non | par acquisition (§4) |
| `RTT` | RTT | oui | oui (solde RTT) | non | forfait/accord |
| `SICK` | Maladie | non (subrogation hors périmètre) | non | arrêt de travail | — |
| `UNPAID` | Sans solde | **non** | non | non | — |
| `FAMILY_EVENT` | Congés exceptionnels (mariage, naissance, décès…) | oui | non (droit dédié daté) | selon motif | barème conventionnel daté |

- Le **barème des congés exceptionnels** (jours par motif : mariage 4 j, décès
  proche N j…) est une **table datée** `FamilyEventRule` (source : Code du travail
  L3142-4 + convention), jamais en dur. Seed « à valider juriste ».
- Extensible : ajouter un type = une ligne de config, pas de code.

## 4. Acquisition des congés payés (`AccrualPolicy`, datée)

- **Période de référence** configurable (défaut légal : **1er juin → 31 mai** ;
  certaines entreprises : année civile). Champ `AccrualPolicy.referenceStart`
  (MM-DD) + `mode` (`STATUTORY_JUNE` | `CALENDAR_YEAR`), daté.
- **Taux d'acquisition** configurable : défaut **2,5 jours ouvrables/mois**
  travaillé (30 j ouvrables/an), ou **2,08 jours ouvrés/mois** (25 j ouvrés/an)
  selon le mode de décompte (§5). Champ `accrualPerMonth` + `unit`.
- **Proratisation** : acquisition au prorata du temps de présence sur la période
  (embauche/sortie en cours de période). Calcul déterministe depuis
  `Employment.startDate`/`endDate` et les absences non acquisitives.
- **Report / clôture** de période : à la bascule de période, le solde acquis
  devient « à prendre » sur la période suivante (règles de report datées ;
  hors-MVP : monétisation). Marqué « à valider juriste ».

## 5. Décompte (`DecountMode`, configurable)

- **Ouvrables** (lun→sam, 6 j/sem) **ou ouvrés** (lun→ven, 5 j/sem) — champ
  `LeaveTypePolicy.decountMode` ou réglage entreprise, daté.
- Le décompte **exclut** les jours fériés chômés et les jours de fermeture
  (`CompanyCalendar`, §7) compris dans la période demandée.
- Règle : `joursDécomptés = joursCalendairesOuvrables(startDate..endDate) − fériésChômés − fermetures`.
  Fonction pure et déterministe (testable), paramétrée par le mode.

## 6. Compteurs & soldes (`LeaveLedger`, append-only)

Un **grand livre daté et append-only** par (employment, type) — jamais d'écrasement :

- **Lignes de mouvement** `LeaveLedgerEntry { employmentId, type, kind, days,
  effectiveDate, sourceRef, createdAt }` avec `kind ∈ ACCRUAL | TAKEN | CORRECTION
  | CARRYOVER | RESET`.
- **Solde à une date** = somme des mouvements dont `effectiveDate ≤ asOf`
  (acquis − pris ± corrections). → **recalcul d'un solde passé** trivial (exigence
  de sortie) : on rejoue le ledger jusqu'à `asOf`.
- **Compteurs exposés** : `acquired`, `taken`, `pending` (demandes en cours),
  `balance = acquired − taken`. `pending` n'entame pas le solde tant que non
  approuvé.
- **Correction** = **nouvelle ligne** `CORRECTION` (±jours, motif) ; la donnée
  originale est conservée (invariant « rien n'est écrasé »).

## 7. Calendrier d'entreprise (`CompanyCalendar`, daté)

Nouvelle entité (par entité juridique / établissement) :

- `Holiday { date, label, worked:boolean }` — jours fériés (seed France « à
  valider juriste » : 11 fériés légaux), `worked=false` = chômé (exclu du décompte).
- `ClosurePeriod { startDate, endDate, label }` — fermetures collectives
  (exclues du décompte ; peuvent imposer une prise de CP selon accord).
- Rattaché à `LegalEntity`/`Establishment`, versionné par année.

## 8. Règles conventionnelles (`leaveRules` via `Agreement`)

- La convention rattachée (Lot 2, `Agreement` daté) peut **surcharger** : droit
  annuel majoré (ancienneté), jours conventionnels supplémentaires, barème des
  congés exceptionnels, période de référence. Résolus **à la date d'effet**.
- Précédence : `Agreement (conventionnel) > AccrualPolicy (entreprise) > défaut légal`.

## 9. Workflow de validation

États `LeaveStatus` (extension) : `REQUESTED → MANAGER_APPROVED → APPROVED`
(+ `REFUSED`, `CANCELLED`). Étape RH **conditionnelle** (config
`LeaveApprovalPolicy.requiresHr`, datée) :

```
Demande (Employee, self)  → REQUESTED
   └─ Manager (scope ORG_UNIT, leave.approve) → MANAGER_APPROVED
        └─ si requiresHr : RH (HrManager) → APPROVED
        └─ sinon : MANAGER_APPROVED == APPROVED (auto)
```

- Contrôle de **solde** à l'approbation finale (déjà présent) : refus si solde
  insuffisant (types décomptés). `pending` réservé dès `REQUESTED`.
- **Annulation** possible avant prise d'effet (Employee ou RH) → `CANCELLED`,
  libère le `pending`.
- Refus à n'importe quelle étape → `REFUSED` (motif conservé).

## 10. Événements (catalogue, enveloppe commune)

| Événement | Aggregate | Payload (clés) | Consommateurs |
|---|---|---|---|
| `LeaveRequested` | LeaveRequest | type, days, période | Notifications, Manager |
| `LeaveManagerApproved` | LeaveRequest | approverId | RH (si requis) |
| `LeaveApproved` | LeaveRequest | type, days, effectiveDate | **Planning**, **Paie (préparation)**, Ledger |
| `LeaveRefused` / `LeaveCancelled` | LeaveRequest | motif | Notifications, Ledger |
| `LeaveBalanceAdjusted` | LeaveLedger | kind, days, motif | Audit |

- **`LeaveApproved`** est **consommé** par : (a) le **planning simple** (marque les
  jours indisponibles) ; (b) la **préparation des variables de paie** (jours **non
  rémunérés** pour `UNPAID`/absences non rémunérées → variable transmise au moteur
  paie tiers, ADR-008). Rhéos **prépare**, ne calcule pas.
- Sans impact juridique/financier direct au sens ADR-010 tant que l'absence
  approuvée reste une **variable** transmise (pas une décision de paie).

## 11. Vues `/me` (self-service) étendues

- `GET /me/leaves` (existant) enrichi : **soldes par type** (`acquired/taken/
  pending/balance`), demandes avec statut détaillé, prochaine échéance.
- `GET /me/leave-balance?type=PAID&asOf=` : solde à une date (rejoue le ledger).
- `POST /me/leaves` (existant) : dépôt de demande (self). Modification = nouvelle
  demande / annulation (jamais d'écrasement).

## 12. Modèle de données proposé (deltas — additifs, migration dédiée)

Nouvelles entités (à ajouter au schéma + specs, validation Aymeric) :
`LeaveTypePolicy`, `AccrualPolicy`, `FamilyEventRule`, `LeaveApprovalPolicy`,
`CompanyCalendar`/`Holiday`/`ClosurePeriod`, `LeaveLedgerEntry`.
Extension enum `LeaveType` (+`FAMILY_EVENT`), `LeaveStatus` (+`MANAGER_APPROVED`).
Suppression de `DEFAULT_ALLOWANCE` codé en dur → `AccrualPolicy`.

## 13. Permissions (RBAC/ABAC)

`leave.request` (Employee self), `leave.approve` (Manager, scope ORG_UNIT),
`leave.approve.hr` (HrManager, étape RH), `leave.balance.read` (self/RH/Manager),
`leave.config` (TenantAdmin : policies/calendrier — donnée légale datée).

## 14. Critères d'acceptation (Gherkin, à implémenter en étape 2)

1. **Cycle complet** : demande CP → Manager approuve → (RH si requis) → `APPROVED`
   → ledger `TAKEN` → `balance` décrémenté → variable de paie (jours) produite.
2. **Décompte** : une demande chevauchant un jour férié chômé décompte un jour de
   moins ; ouvrés vs ouvrables donne des décomptes différents (config).
3. **Recalcul passé** : `leave-balance?asOf=<date passée>` reconstruit le solde
   d'alors depuis le ledger (append-only), inchangé par les mouvements ultérieurs.
4. **Append-only** : une correction ajoute une ligne `CORRECTION` ; la ligne
   `TAKEN` initiale reste présente et inchangée.
5. **Non rémunéré** : un `UNPAID` approuvé produit une variable « jours non
   rémunérés » dans la préparation paie.

## 15. Questions ouvertes (validation Aymeric / juriste)

1. **Décompte par défaut** : ouvrables (30 j) ou ouvrés (25 j) au niveau produit ?
2. **Étape RH** : activée par défaut, ou uniquement si `requiresHr` configuré ?
3. **Période de référence** par défaut : légale (juin→mai) ou année civile ?
4. **Congés exceptionnels** : barème de départ (à confirmer juriste) — mariage 4 j,
   PACS 4 j, naissance 3 j, décès conjoint/enfant N j… ?
5. **Report** de solde en fin de période : autorisé, plafonné, ou perte ?

---

**Prochaine étape** : validation de cette spec (au moins §9 workflow, §5 décompte,
§15) → puis étape 2 (implémentation + tests des 5 critères d'acceptation).
