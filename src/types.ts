// Rhéos — types du noyau (miroir du schema.prisma, ADR-002 : anglais).

// ARCHIVED : état terminal après la sortie (post-rétention). L'Employment n'est
// jamais supprimé ; une réembauche crée un NOUVEL Employment (jamais un doublon).
export type EmploymentStatus = "PRE_HIRE" | "ACTIVE" | "SUSPENDED" | "ON_LEAVE" | "EXITING" | "ENDED" | "ARCHIVED";
export type ContractType = "CDI" | "CDD" | "APPRENTICESHIP" | "PROFESSIONALIZATION" | "INTERNSHIP" | "TEMPORARY" | "SEASONAL";
export type ContractStatus = "DRAFT" | "REVIEW" | "VALIDATED" | "SIGNED" | "ACTIVE" | "SUSPENDED" | "ENDED";
export type WorkingTimeUnit = "HOURS_PER_WEEK" | "HOURS_PER_MONTH" | "DAYS_PER_YEAR";
export type DocumentType = "CONTRACT" | "AMENDMENT" | "PAYSLIP" | "CERTIFICATE" | "ID_DOCUMENT" | "ADMINISTRATIVE" | "OTHER";

export interface LegalEntity { id: string; tenantId: string; legalName: string; tradeName?: string; legalForm?: string; siren: string; status: string; groupId?: string; }
export interface Establishment { id: string; tenantId: string; legalEntityId: string; siret: string; name: string; addressLine?: string; postalCode?: string; city?: string; idcc?: string; status: "ACTIVE" | "CLOSED"; closureDate?: string; validFrom?: string; validTo?: string; }
export interface OperatingSite { id: string; tenantId: string; establishmentId: string; name: string; }
export interface Position { id: string; tenantId: string; legalEntityId: string; title: string; classification?: string; coefficient?: number; }

export interface Person { id: string; tenantId: string; lastName: string; firstName: string; usageName?: string; birthDate?: string; personalEmail?: string; }

// D2b — Coordonnées historisées (SCD-2) & identifiants sensibles (chiffrés).
export type AddressType = "HOME" | "POSTAL" | "OTHER";
export interface Address { id: string; tenantId: string; personId: string; type: AddressType; line1: string; line2?: string; postalCode: string; city: string; country: string; validFrom: string; validTo?: string; }
// Statuts IBAN (schema.prisma) : FURNISHED = « fournie/PROVIDED » (consigne Lot 11).
export type BankAccountStatus = "FURNISHED" | "TO_VERIFY" | "VALIDATED" | "REJECTED" | "REPLACED";
export interface BankAccount { id: string; tenantId: string; personId: string; ibanLast4: string; ibanEnc: string; bic?: string; holderName?: string; status: BankAccountStatus; validFrom: string; validTo?: string; }
export type SensitiveIdType = "NIR" | "ID_CARD" | "PASSPORT" | "RESIDENCE_PERMIT" | "DRIVING_LICENSE";
export interface SensitiveIdentifier { id: string; tenantId: string; personId: string; type: SensitiveIdType; valueEnc: string; validFrom: string; validTo?: string; }
// Journal d'audit métier (qui/quand/quoi/avant/après/contexte).
export interface AuditLog { id: string; tenantId?: string; userId?: string; action: string; entityType: string; entityId: string; before?: any; after?: any; reason?: string; ip?: string; at: string; }
// Change request self-service : le collaborateur ne modifie jamais directement.
export type ChangeRequestStatus = "REQUESTED" | "APPROVED" | "REFUSED";
export interface ChangeRequest { id: string; tenantId: string; personId: string; employmentId?: string; field: string; requestedValue: any; status: ChangeRequestStatus; reason?: string; decidedBy?: string; createdAt: string; }
export interface Employment { id: string; tenantId: string; personId: string; legalEntityId: string; administrativeEstablishmentId?: string; startDate: string; endDate?: string; status: EmploymentStatus; }
export interface Contract { id: string; tenantId: string; employmentId: string; type: ContractType; startDate: string; endDate?: string; workingTime?: number; workingTimeUnit: WorkingTimeUnit; classification?: string; coefficient?: number; grossMonthly?: number; status: ContractStatus; }
export interface Assignment { id: string; tenantId: string; employmentId: string; operatingSiteId?: string; orgUnitId?: string; positionId?: string; managerEmploymentId?: string; allocationPct?: number; validFrom: string; validTo?: string; }
export type AmendmentStatus = "DRAFT" | "VALIDATED" | "SIGNED" | "APPLIED";
export interface ContractAmendment { id: string; tenantId: string; contractId: string; subject: string; effectiveDate: string; changes: any; status: AmendmentStatus; signedAt?: string; }
// D10 — Coffre-fort. Cycle de vie documentaire (distinct de la signature).
export type DocumentStatus = "DRAFT" | "REVIEW" | "VALIDATED" | "SIGNED" | "PUBLISHED" | "ARCHIVED";
// Coffre-fort : le CONTENU n'est jamais stocké ici (seul le sha256 + storageRef).
// 14 métadonnées : type, category, personId(collaborateur), employmentId, label,
// periodStart, periodEnd, version, status, signatureStatus, retentionUntil,
// legalHold, sha256, createdAt (+ traçabilité createdBy, signedAt, signatureProof).
export interface Doc {
  id: string; tenantId: string; personId?: string; employmentId?: string;
  type: DocumentType; category?: string; label: string;
  periodStart?: string; periodEnd?: string; version: number;
  storageRef: string; sha256: string;
  contentType?: string; sizeBytes?: number; // Lot 19 — contenu réellement stocké
  status: DocumentStatus; signatureStatus: "NONE" | "PENDING" | "SIGNED" | "REFUSED";
  signedAt?: string; signatureProof?: string;
  retentionUntil?: string; retentionTrigger?: string; legalHold?: boolean;
  createdBy?: string; createdAt?: string; anonymizedAt?: string;
}
export interface HrEvent { id: string; tenantId: string; employmentId?: string; personId?: string; type: string; occurredAt: string; effectiveDate?: string; payload?: any; }
export interface DomainEvent { id: string; tenantId: string; aggregateType: string; aggregateId: string; type: string; version: number; sequence: number; payload: any; occurredAt: string; actorUserId?: string; }

// D1 — Convention collective rattachée (datée) — Agreement (schema.prisma)
export type AgreementType = "COLLECTIVE" | "BRANCH" | "COMPANY" | "ESTABLISHMENT" | "INTERNAL_POLICY";
export interface Agreement {
  id: string; tenantId: string; legalEntityId?: string; type: AgreementType;
  idcc?: string; title: string; source?: string; version?: string;
  effectiveFrom: string; effectiveTo?: string;
}

// D1 — Effectif historisé (SCD-2), calculé, jamais saisi
export interface WorkforceSnapshot {
  id: string; tenantId: string; legalEntityId?: string; establishmentId?: string;
  asOfDate: string; headcount: number; etp?: number; method?: string;
}

// D1 — Obligations déclenchées par les effectifs.
// ARCHIVED : état terminal (l'obligation n'est jamais supprimée — invariant « rien n'est écrasé »).
export type ObligationStatus = "DETECTED" | "QUALIFIED" | "ACTIVE" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE" | "NOT_APPLICABLE" | "ARCHIVED";
export interface Obligation {
  id: string; tenantId: string; legalEntityId: string; code: string; title: string;
  source?: string; triggerDescription?: string; deadline?: string; status: ObligationStatus; risk?: string;
}

// D8 — Dialogue social / IRP (CSE)
export type CseRole = "TITULAIRE" | "SUPPLEANT" | "SECRETAIRE" | "TRESORIER" | "REFERENT_HARCELEMENT" | "REPRESENTANT_SYNDICAL";
export interface CseMandate { id: string; tenantId: string; legalEntityId: string; employmentId: string; role: CseRole; college?: string; startDate: string; endDate?: string; status: "ACTIVE" | "ENDED"; }
export type MeetingType = "ORDINAIRE" | "EXTRAORDINAIRE";
export type MeetingStatus = "PLANNED" | "HELD" | "CANCELLED";
export interface CseMeeting { id: string; tenantId: string; legalEntityId: string; date: string; type: MeetingType; agenda: string[]; status: MeetingStatus; minutes?: string; }
export type NegotiationTheme = "SALAIRES" | "TEMPS_TRAVAIL" | "EGALITE_PRO" | "QVT" | "AUTRE";
export type NegotiationStatus = "PLANNED" | "IN_PROGRESS" | "AGREEMENT" | "DISAGREEMENT";
export interface Negotiation { id: string; tenantId: string; legalEntityId: string; year: number; theme: NegotiationTheme; status: NegotiationStatus; startDate?: string; notes?: string; }

// D5 — Pilotage économique & financier
export interface Budget { id: string; tenantId: string; legalEntityId: string; year: number; amount: number; version: number; }

// D7 — Carrière, Compétences & Formation
export type CompetencyLevel = "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | "EXPERT";
export interface Competency { id: string; tenantId: string; employmentId: string; name: string; level: CompetencyLevel; acquiredDate?: string; expiresAt?: string; }
export type TrainingType = "MANDATORY" | "SKILL" | "SAFETY" | "OTHER";
export type TrainingStatus = "PLANNED" | "DONE" | "CANCELLED";
export interface Training { id: string; tenantId: string; legalEntityId: string; employmentId: string; title: string; type: TrainingType; status: TrainingStatus; date?: string; dueDate?: string; provider?: string; }
export type ReviewType = "ANNUAL" | "PROFESSIONAL";
export type ReviewStatus = "PLANNED" | "HELD";
export interface CareerReview { id: string; tenantId: string; employmentId: string; type: ReviewType; date: string; status: ReviewStatus; notes?: string; }

// D6 — Santé, Sécurité & Prévention (données de prévention employeur ; PAS de
// données médicales individuelles, qui relèvent du HDS / secret médical — ADR-009)
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";
export type RiskStatus = "OPEN" | "CONTROLLED";
export interface Risk { id: string; tenantId: string; legalEntityId: string; unit?: string; hazard: string; gravity: number; probability: number; score: number; level: RiskLevel; measures?: string; actionPlan?: string; status: RiskStatus; }
export type AccidentSeverity = "BENIGN" | "LOST_TIME" | "SERIOUS";
export interface WorkAccident { id: string; tenantId: string; legalEntityId: string; employmentId?: string; date: string; description: string; severity: AccidentSeverity; lostDays?: number; }

// D9 — Institutions & Pouvoirs publics
export type Authority = "INSPECTION_TRAVAIL" | "URSSAF" | "CARSAT" | "DREETS" | "MEDECINE_TRAVAIL" | "AUTRE";
export type InteractionType = "CONTROLE" | "DEMANDE" | "DECLARATION" | "MISE_EN_DEMEURE" | "COURRIER";
export type InteractionStatus = "OPEN" | "IN_PROGRESS" | "RESPONDED" | "CLOSED";
export interface AuthorityInteraction { id: string; tenantId: string; legalEntityId: string; authority: Authority; type: InteractionType; reference?: string; date: string; dueDate?: string; status: InteractionStatus; notes?: string; responseDate?: string; }

// Veille & échéances
export type DeadlineStatus = "OPEN" | "DONE";
export interface Deadline { id: string; tenantId: string; legalEntityId?: string; employmentId?: string; type: string; label: string; dueDate: string; status: DeadlineStatus; }

// D3 — Planning & pointage
export interface Shift { id: string; tenantId: string; employmentId: string; date: string; startTime: string; endTime: string; operatingSiteId?: string; hours: number; }
export interface TimeEntry { id: string; tenantId: string; employmentId: string; date: string; clockIn: string; clockOut: string; hours: number; }

// D3 — Temps & activité (socle MVP)
export type LeaveType = "PAID" | "RTT" | "SICK" | "UNPAID" | "FAMILY_EVENT";
// Workflow validé : REQUESTED → MANAGER_APPROVED → APPROVED (étape RH conditionnelle).
export type LeaveStatus = "REQUESTED" | "MANAGER_APPROVED" | "APPROVED" | "REFUSED" | "CANCELLED";
export interface LeaveRequest {
  id: string; tenantId: string; employmentId: string; type: LeaveType;
  startDate: string; endDate: string; days: number; status: LeaveStatus;
  reason?: string; decidedBy?: string; managerApprovedBy?: string;
}

// Grand livre des congés — APPEND-ONLY (jamais d'écrasement). Le solde à une date
// se reconstruit en rejouant les mouvements dont effectiveDate ≤ asOf.
export type LeaveLedgerKind = "ACCRUAL" | "TAKEN" | "CORRECTION" | "CARRYOVER" | "RESET";
export interface LeaveLedgerEntry {
  id: string; tenantId: string; employmentId: string; type: LeaveType;
  kind: LeaveLedgerKind; days: number; effectiveDate: string;
  sourceRef?: string; reason?: string; createdBy?: string; createdAt: string;
}

// --- Autorisation ABAC (permissions.md, Tome 04) ---------------------------
// Périmètre d'une attribution rôle→utilisateur. Hiérarchie décroissante :
// TENANT ⊃ LEGAL_ENTITY ⊃ ESTABLISHMENT ⊃ ORG_UNIT ; SELF est orthogonal.
export type ScopeType = "TENANT" | "LEGAL_ENTITY" | "ESTABLISHMENT" | "ORG_UNIT" | "SELF";
export interface Scope { type: ScopeType; id?: string }

export interface Ctx {
  tenantId: string;
  userId?: string;
  personId?: string;
  roles: string[];
  // Périmètres ABAC portés par le jeton (ADR-006). Optionnel : les contrôles
  // RBAC purs (assertCan) n'en dépendent pas ; seuls les contrôles scopés
  // (assertScope/authorize) l'utilisent. Absence ⇒ aucun périmètre accordé.
  scopes?: Scope[];
}

// Journal des interactions IA (ADR-010) : toute interaction IA est tracée
// (données utilisées, version du prompt/contrat). L'IA n'écrit jamais en base.
export type AiInteractionKind = "EXTRACTION" | "BRIEFING" | "ASSISTANT";
export interface AiAuditLog {
  id: string; tenantId: string; userId?: string; kind: AiInteractionKind;
  query?: string; dataUsed: string[]; version: string; outcome: string; at: string;
}

// R1 — Référentiel réglementaire (PLATEFORME, hors RLS tenant ; lecture seule pour les
// tenants). Voir ADR-020. Pas de tenantId : ces données sont partagées par tous les tenants.
export type RegulatoryRuleType = "MINIMUM_WAGE" | "CLASSIFICATION" | "PROBATION" | "NOTICE" | "LEAVE" | "BONUS";
export type RegulatoryRuleStatus = "PROPOSED" | "VALIDATED" | "PUBLISHED" | "SUPERSEDED";
export interface RegulatorySource { id: string; name: string; url: string; fetchedAt: string; }
export interface RegulatoryText {
  id: string; idcc: string; kaliId: string; title: string; version: number;
  effectiveDate?: string; content: string; hash: string; sourceUrl?: string; fetchedAt: string;
}
export interface RegulatoryRule {
  id: string; idcc: string; type: RegulatoryRuleType; params: any;
  effectiveFrom: string; effectiveTo?: string; sourceRef: string;
  status: RegulatoryRuleStatus; validatedBy?: string; publishedAt?: string;
}

// Identité / authentification (Lot UI-1b — fondation). Table PLATEFORME (hors RLS
// tenant) : l'authentification résout un email GLOBAL → tenant + rôles + périmètre,
// avant tout contexte tenant. `tokenVersion` permet d'invalider toutes les sessions
// d'un compte (incrément au reset). `mustChangePassword` force le changement (mot de
// passe temporaire). Le hash est scrypt (comme le reste de l'auth).
export interface AuthAccount {
  id: string;
  email: string;
  tenantId: string;
  personId?: string;
  passwordHash: string;
  roleNames: string[];
  scopes?: Scope[];
  tokenVersion: number;
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: string;
}

// Jeton de réinitialisation de mot de passe (Lot UI-1b). Table PLATEFORME (hors RLS) :
// consultée par HASH, avant toute authentification. Le token en clair n'est JAMAIS stocké
// (seulement son SHA-256) ; usage unique (usedAt) ; expiration (expiresAt, 60 min).
export interface PasswordResetToken {
  id: string;
  accountId: string;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
}

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}
