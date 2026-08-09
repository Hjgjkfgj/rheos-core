# Rhéos — Catalogue d'événements (à jour, MVP P1+P2)

Événements **immuables**, **append-only** (table `DomainEvent`), enveloppe commune
(`eventId=id, tenantId, aggregateType, aggregateId, type, version, sequence,
occurredAt, actorUserId, payload`). Commande ≠ événement (ADR-005). Ce catalogue
reflète l'implémentation ; les entrées marquées ✚ sont **à répercuter dans
`rheos-specs-d1-d2/events/event-catalog.md`** (validation Aymeric).

## D1 — Entreprise & Référentiel
| Événement | Aggregate | Statut |
|---|---|---|
| `CompanyCreated` | LegalEntity | catalogue |
| `EstablishmentCreated` | Establishment | catalogue |
| `EstablishmentClosed` | Establishment | catalogue |
| `OperatingSiteCreated` | OperatingSite | catalogue |
| `PositionCreated` | Position | catalogue |
| `AgreementLinked` | Agreement | catalogue |
| `WorkforceThresholdCrossed` | LegalEntity | catalogue |
| `ObligationTriggered` | Obligation | catalogue |
| `ObligationStatusChanged` | Obligation | ✚ (cycle de vie, Lot 2) |

## D2 — Dossier collaborateur
| Événement | Aggregate | Statut |
|---|---|---|
| `PersonCreated` | Person | catalogue |
| `EmployeeHired` | Employment | catalogue |
| `ContractCreated` | Contract | catalogue |
| `ContractValidated` | Contract | ✚ (séparation create/validate, Lot 3) |
| `ContractSigned` | Contract | catalogue |
| `ContractActivated` | Contract | catalogue |
| `AmendmentCreated` / `AmendmentSigned` / `AmendmentApplied` | ContractAmendment | catalogue (Applied ✚) |
| `EmployeeAssigned` / `EmployeeMobility` | Assignment | catalogue |
| `EmployeeDeparture` | Employment | catalogue |
| `EmploymentArchived` | Employment | ✚ (post-rétention, Lot 3) |

## D10 — Coffre-fort & documents
| Événement | Aggregate | Statut |
|---|---|---|
| `DocumentDeposited` | Document | catalogue |
| `SignatureRequested` / `DocumentSigned` | Document | catalogue |
| `DocumentValidated` / `DocumentPublished` / `DocumentArchived` | Document | ✚ (cycle de vie, Lot 4) |
| `DocumentAnonymized` / `DocumentDeleted` | Document | ✚ (RGPD, Lot 4) |
| `LegalHoldPlaced` / `LegalHoldReleased` | Document | ✚ (Lot 4) |

## Socle Temps (D3)
| Événement | Aggregate | Statut |
|---|---|---|
| `LeaveRequested` | LeaveRequest | catalogue |
| `LeaveManagerApproved` | LeaveRequest | ✚ (workflow, Lot 5) |
| `LeaveApproved` / `LeaveRefused` | LeaveRequest | catalogue |
| `LeaveBalanceAdjusted` | LeaveLedgerEntry | ✚ (correction, Lot 5) |
| `ShiftPlanned` / `TimeRecorded` | Shift / TimeEntry | existant |
| `PayrollVariablesPrepared` | Employment | existant (préparation paie, ADR-008) |

## Domaines existants (D5-D9, hors périmètre MVP mais présents)
`BudgetSet`, `RiskAssessed`, `WorkAccidentDeclared`, `CompetencyAdded`,
`TrainingPlanned`/`TrainingCompleted`, `ReviewPlanned`, `DeadlineCreated`,
`CseMandateCreated`, `CseMeetingPlanned`/`CseMeetingHeld`, `NegotiationOpened`,
`AuthorityInteractionCreated`/`Responded`/`Closed`.

> Règle de gouvernance : tout événement à impact juridique/financier
> (`ContractSigned`, `EmployeeDeparture`) exige une **validation humaine préalable**
> (Human-in-the-Loop, ADR-010). Les projections (Employee 360, RUP) sont
> reconstruisibles depuis les événements (base du Temporal Query `?asOf=`).
