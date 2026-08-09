// Autorisation (ADR-006 + Tome 04 + security/permissions.md).
// Décision finale = tenant (RLS) ET permission atomique (RBAC) ET périmètre (ABAC).
// Deny by default : rien n'est accordé sans permission explicite.
//
//   - RBAC  : assertCan(ctx, "contract.sign")           — verbe atomique
//   - ABAC  : assertScope(ctx, { legalEntityId })       — périmètre
//   - Combiné : authorize(ctx, "employment.write", res) — les deux
//
// Rétro-compatibilité : assertCan/can gardent leur signature (permission seule).
// Les périmètres sont additifs (les appels existants ne passent pas de scope).
import { Ctx, Scope, ScopeType, AppError } from "./types.js";

// =============================================================================
// 1. Permissions atomiques par rôle (superset : atomiques de permissions.md §3
//    + permissions transverses D3-D9 déjà utilisées par le noyau existant).
//    Donnée de configuration, jamais une règle légale (invariant #6).
// =============================================================================
const SPEC_D1_D2: Record<string, string[]> = {
  // Rôles standard de permissions.md §2 (9 profils).
  PlatformAdmin: ["platform.admin", "audit.read"],
  TenantAdmin: ["*"], // tenant.admin + tous les *.read/write du tenant
  HrManager: [
    // NB : pas de company.write — l'onboarding d'une entité juridique est un acte
    // TenantAdmin (permissions.md §3 : company.write = TenantAdmin uniquement).
    // HrManager opère À L'INTÉRIEUR d'une entité (périmètre LEGAL_ENTITY).
    "company.read", "establishment.read", "establishment.write", "establishment.close",
    "organization.read", "organization.write", "person.read", "person.write",
    "person.sensitive.read", "employment.read", "employment.write",
    "contract.read", "contract.create", "contract.validate",
    "amendment.create", "assignment.write", "document.read", "document.write",
    "document.delete", "document.legal_hold",
    "person.sensitive.write", "bank_account.write", "change_request.validate",
    "registry.read", "registry.export", "employee360.read", "obligation.manage",
  ],
  HrOfficer: [
    "company.read", "establishment.read", "organization.read",
    "person.read", "person.write", "employment.read", "employment.write",
    "contract.read", "contract.create", "assignment.write",
    "document.read", "document.write", "employee360.read",
  ],
  Signatory: [
    "company.read", "contract.read", "contract.sign", "amendment.sign",
    "employment.departure", "document.read", "employee360.read",
  ],
  Manager: ["employee360.read", "assignment.read", "document.read"],
  Employee: ["person.read", "employee360.read", "document.read", "document.sign.self", "bank_account.read"],
  PayrollOfficer: [
    "bank_account.read", "employment.read", "contract.read",
    "person.sensitive.read", "employee360.read",
  ],
  ExternalAuditor: ["audit.read", "employee360.read", "document.read"],
};

// Permissions transverses D3-D9 conservées du noyau existant (hors périmètre
// contractuel D1/D2, mais nécessaires aux services actuels). Attachées aux
// mêmes rôles qu'auparavant pour ne casser aucun comportement.
const EXTRA_CROSS_DOMAIN: Record<string, string[]> = {
  HrManager: [
    "leave.request", "leave.approve", "leave.approve.hr", "payroll.prepare", "notifications.read",
    "planning.write", "planning.read", "time.record", "social.read", "social.write",
    "authority.read", "authority.write", "health.read", "health.write",
    "talent.read", "talent.write", "finance.read", "finance.write",
  ],
  HrOfficer: ["leave.request", "notifications.read", "planning.write", "planning.read", "time.record"],
  Signatory: ["document.sign", "notifications.read", "social.read"],
  Manager: ["leave.approve", "notifications.read", "planning.write", "planning.read", "time.record", "social.read"],
  Employee: ["leave.request", "time.record", "planning.read", "change_request.submit"],
  PayrollOfficer: ["payroll.prepare", "finance.read"],
};

function mergeRolePerms(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const roles = new Set([...Object.keys(SPEC_D1_D2), ...Object.keys(EXTRA_CROSS_DOMAIN)]);
  for (const r of roles) {
    out[r] = Array.from(new Set([...(SPEC_D1_D2[r] ?? []), ...(EXTRA_CROSS_DOMAIN[r] ?? [])]));
  }
  return out;
}

export const ROLE_PERMS: Record<string, string[]> = mergeRolePerms();
export const STANDARD_ROLES = Object.keys(SPEC_D1_D2); // les 9 rôles standard

// Permissions dont la LECTURE est sensible → journalisation obligatoire (invariant #10).
export const SENSITIVE_PERMS = new Set(["person.sensitive.read", "bank_account.read"]);

// Périmètre par défaut d'un rôle (utilisé au seed ; les jetons peuvent surcharger).
export const DEFAULT_SCOPE_TYPE: Record<string, ScopeType> = {
  PlatformAdmin: "TENANT", TenantAdmin: "TENANT",
  HrManager: "LEGAL_ENTITY", HrOfficer: "ESTABLISHMENT",
  Signatory: "LEGAL_ENTITY", Manager: "ORG_UNIT",
  Employee: "SELF", PayrollOfficer: "LEGAL_ENTITY", ExternalAuditor: "LEGAL_ENTITY",
};

// =============================================================================
// 2. RBAC — permission atomique (inchangé, deny by default)
// =============================================================================
export function permissionsOf(roles: string[]): Set<string> {
  const s = new Set<string>();
  for (const r of roles) for (const p of ROLE_PERMS[r] ?? []) s.add(p);
  return s;
}

export function can(ctx: Ctx, perm: string): boolean {
  const perms = permissionsOf(ctx.roles);
  return perms.has("*") || perms.has(perm);
}

export function assertCan(ctx: Ctx, perm: string): void {
  if (!can(ctx, perm)) {
    throw new AppError(403, "forbidden", `Permission requise : ${perm}`);
  }
}

// =============================================================================
// 3. ABAC — périmètre. Une ressource expose sa chaîne d'appartenance ;
//    un scope de l'utilisateur l'autorise s'il la couvre.
// =============================================================================
export interface ResourceScope {
  legalEntityId?: string;
  establishmentId?: string;
  orgUnitId?: string;
  personId?: string;
}

/** Vrai si au moins un périmètre de l'utilisateur couvre la ressource. */
export function inScope(ctx: Ctx, res: ResourceScope): boolean {
  const scopes = ctx.scopes ?? [];
  for (const s of scopes) {
    switch (s.type) {
      case "TENANT": return true; // tout le tenant (déjà borné par la RLS)
      case "LEGAL_ENTITY": if (s.id && s.id === res.legalEntityId) return true; break;
      case "ESTABLISHMENT": if (s.id && s.id === res.establishmentId) return true; break;
      case "ORG_UNIT": if (s.id && s.id === res.orgUnitId) return true; break;
      case "SELF": if (res.personId && res.personId === ctx.personId) return true; break;
    }
  }
  return false;
}

export function assertScope(ctx: Ctx, res: ResourceScope): void {
  if (!inScope(ctx, res)) {
    throw new AppError(403, "forbidden", "Hors périmètre (ABAC)");
  }
}

/** Contrôle combiné : permission atomique ET périmètre (si une ressource est fournie). */
export function authorize(ctx: Ctx, perm: string, res?: ResourceScope): void {
  assertCan(ctx, perm);
  if (res) assertScope(ctx, res);
}

/** Construit les scopes par défaut d'un ensemble de rôles (seed / jetons de démo). */
export function defaultScopesFor(roles: string[], binding: { legalEntityId?: string; establishmentId?: string; orgUnitId?: string } = {}): Scope[] {
  const out: Scope[] = [];
  for (const r of roles) {
    const type = DEFAULT_SCOPE_TYPE[r] ?? "TENANT";
    if (type === "LEGAL_ENTITY") out.push({ type, id: binding.legalEntityId });
    else if (type === "ESTABLISHMENT") out.push({ type, id: binding.establishmentId });
    else if (type === "ORG_UNIT") out.push({ type, id: binding.orgUnitId });
    else out.push({ type }); // TENANT | SELF
  }
  return out;
}
