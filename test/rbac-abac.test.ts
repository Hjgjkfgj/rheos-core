// Matrice de permissions (security/permissions.md §3) + ABAC (§4).
// Teste directement le moteur d'autorisation : RBAC atomique, séparation des
// responsabilités (créer ≠ signer), deny by default, et périmètres ABAC.
import { describe, it, expect } from "vitest";
import {
  can, inScope, authorize, permissionsOf, STANDARD_ROLES, ROLE_PERMS,
} from "../src/auth.js";
import { Ctx, Scope } from "../src/types.js";

const ctx = (roles: string[], extra: Partial<Ctx> = {}): Ctx => ({ tenantId: "ACME", roles, ...extra });

describe("RBAC — matrice rôle × permission (permissions.md §3)", () => {
  // [permission, rôles attendus AUTORISÉS]. TenantAdmin (joker) autorisé partout.
  const M: Array<[string, string[]]> = [
    ["company.write", ["TenantAdmin"]],
    ["establishment.write", ["TenantAdmin", "HrManager"]],
    ["person.write", ["TenantAdmin", "HrManager", "HrOfficer"]],
    ["person.sensitive.read", ["TenantAdmin", "HrManager", "PayrollOfficer"]],
    ["bank_account.read", ["TenantAdmin", "PayrollOfficer", "Employee"]],
    ["contract.create", ["TenantAdmin", "HrManager", "HrOfficer"]],
    ["contract.validate", ["TenantAdmin", "HrManager"]],
    ["contract.sign", ["TenantAdmin", "Signatory"]],
    ["employment.departure", ["TenantAdmin", "Signatory"]],
    ["registry.export", ["TenantAdmin", "HrManager"]],
    ["audit.read", ["TenantAdmin", "PlatformAdmin", "ExternalAuditor"]],
  ];

  for (const [perm, allowed] of M) {
    it(`${perm} : autorisé pour [${allowed.join(", ")}] uniquement`, () => {
      for (const role of STANDARD_ROLES) {
        const expected = allowed.includes(role);
        expect(can(ctx([role]), perm), `${role} → ${perm}`).toBe(expected);
      }
    });
  }

  it("séparation des responsabilités : HrManager crée mais ne signe pas ; Signatory signe mais ne crée pas", () => {
    expect(can(ctx(["HrManager"]), "contract.create")).toBe(true);
    expect(can(ctx(["HrManager"]), "contract.sign")).toBe(false);
    expect(can(ctx(["Signatory"]), "contract.sign")).toBe(true);
    expect(can(ctx(["Signatory"]), "contract.create")).toBe(false);
  });

  it("deny by default : une permission inconnue est refusée (sauf joker TenantAdmin)", () => {
    expect(can(ctx(["HrManager"]), "does.not.exist")).toBe(false);
    expect(can(ctx(["Employee"]), "contract.sign")).toBe(false);
    expect(can(ctx(["TenantAdmin"]), "does.not.exist")).toBe(true); // "*"
  });

  it("les 9 rôles standard de permissions.md §2 sont définis", () => {
    expect(STANDARD_ROLES.sort()).toEqual([
      "Employee", "ExternalAuditor", "HrManager", "HrOfficer", "Manager",
      "PayrollOfficer", "PlatformAdmin", "Signatory", "TenantAdmin",
    ]);
    for (const r of STANDARD_ROLES) expect(ROLE_PERMS[r]?.length).toBeGreaterThan(0);
  });

  it("un rôle inconnu n'accorde aucune permission", () => {
    expect(permissionsOf(["Inexistant"]).size).toBe(0);
  });
});

describe("ABAC — périmètres (permissions.md §4)", () => {
  const S = (scopes: Scope[], personId?: string): Ctx => ({ tenantId: "ACME", roles: ["HrManager"], scopes, personId });

  it("TENANT couvre toute ressource du tenant", () => {
    expect(inScope(S([{ type: "TENANT" }]), { legalEntityId: "le-2" })).toBe(true);
  });

  it("LEGAL_ENTITY ne couvre que son entité", () => {
    const c = S([{ type: "LEGAL_ENTITY", id: "le-1" }]);
    expect(inScope(c, { legalEntityId: "le-1" })).toBe(true);
    expect(inScope(c, { legalEntityId: "le-2" })).toBe(false);
  });

  it("ESTABLISHMENT ne couvre que son établissement", () => {
    const c = S([{ type: "ESTABLISHMENT", id: "es-1" }]);
    expect(inScope(c, { establishmentId: "es-1" })).toBe(true);
    expect(inScope(c, { establishmentId: "es-2" })).toBe(false);
  });

  it("SELF ne couvre que la personne du jeton", () => {
    const c = S([{ type: "SELF" }], "p-1");
    expect(inScope(c, { personId: "p-1" })).toBe(true);
    expect(inScope(c, { personId: "p-2" })).toBe(false);
  });

  it("aucun scope ⇒ hors périmètre (deny by default)", () => {
    expect(inScope(S([]), { legalEntityId: "le-1" })).toBe(false);
  });

  it("authorize = permission ET périmètre", () => {
    const c: Ctx = { tenantId: "ACME", roles: ["HrManager"], scopes: [{ type: "LEGAL_ENTITY", id: "le-1" }] };
    // a la permission + dans le périmètre → ok
    expect(() => authorize(c, "employment.write", { legalEntityId: "le-1" })).not.toThrow();
    // a la permission mais HORS périmètre → 403
    expect(() => authorize(c, "employment.write", { legalEntityId: "le-2" })).toThrow(/périmètre/);
    // dans le périmètre mais PAS la permission → 403
    expect(() => authorize(c, "contract.sign", { legalEntityId: "le-1" })).toThrow(/Permission/);
  });
});
