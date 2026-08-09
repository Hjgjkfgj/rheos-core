// Isolation multi-tenant (ADR-006) — preuve renforcée : le tenant A ne peut
// jamais LIRE, LISTER ni RECHERCHER une donnée du tenant B. Deux niveaux :
//   (1) port Repository (MemoryRepository simule la RLS : filtre tenantId partout)
//   (2) API (get cross-tenant → 404 ; registre scopé ; doublon inter-tenant ignoré)
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { MemoryRepository } from "../src/repository.js";
import { hrManager, tenantAdmin } from "./helpers.js";

describe("Isolation tenant — port Repository (recherche & scans)", () => {
  let repo: MemoryRepository;
  beforeEach(async () => {
    repo = new MemoryRepository();
    // Même identité métier dans deux tenants distincts.
    for (const t of ["A", "B"]) {
      const le = await repo.createLegalEntity({ id: `le-${t}`, tenantId: t, legalName: "ACME SAS", siren: "552100554", status: "ACTIVE" });
      const person = await repo.createPerson({ id: `p-${t}`, tenantId: t, lastName: "Dupont", firstName: "Marie", birthDate: "1990-05-12" });
      const emp = await repo.createEmployment({ id: `emp-${t}`, tenantId: t, personId: person.id, legalEntityId: le.id, startDate: "2026-09-01", status: "ACTIVE" });
      await repo.createContract({ id: `ct-${t}`, tenantId: t, employmentId: emp.id, type: "CDI", startDate: "2026-09-01", status: "ACTIVE" } as any);
      await repo.createDocument({ id: `doc-${t}`, tenantId: t, personId: person.id, type: "CONTRACT", label: "Contrat", storageRef: "ref", sha256: "x", signatureStatus: "NONE" } as any);
      await repo.createObligation({ id: `ob-${t}`, tenantId: t, legalEntityId: le.id, code: "BDESE", title: "BDESE" } as any);
    }
  });

  it("getById d'une ressource de B depuis A → introuvable", async () => {
    expect(await repo.getLegalEntity("A", "le-B")).toBeUndefined();
    expect(await repo.getPerson("A", "p-B")).toBeUndefined();
    expect(await repo.getEmployment("A", "emp-B")).toBeUndefined();
    expect(await repo.getContract("A", "ct-B")).toBeUndefined();
    // mais visible depuis son propre tenant
    expect(await repo.getLegalEntity("B", "le-B")).toBeDefined();
  });

  it("RECHERCHE de doublon de personne scopée au tenant (ne voit pas B)", async () => {
    const inA = await repo.findPersonDuplicates("A", "Dupont", "Marie", "1990-05-12");
    expect(inA.map((p) => p.tenantId)).toEqual(["A"]);
    expect(inA.some((p) => p.tenantId === "B")).toBe(false);
  });

  it("les listes par entité ne renvoient que le tenant demandé", async () => {
    expect((await repo.listEmploymentsByCompany("A", "le-A")).every((e) => e.tenantId === "A")).toBe(true);
    expect(await repo.listEmploymentsByCompany("A", "le-B")).toHaveLength(0); // entité de B
    expect((await repo.listDocumentsByPerson("A", "p-A")).every((d) => d.tenantId === "A")).toBe(true);
    expect(await repo.listDocumentsByPerson("A", "p-B")).toHaveLength(0);
  });

  it("les scans tenant-wide (notifications, registre) ne fuient jamais l'autre tenant", async () => {
    for (const scan of [
      repo.listContractsByTenant("A"),
      repo.listDocumentsByTenant("A"),
      repo.listObligationsByTenant("A"),
      repo.listEmploymentsByTenant("A"),
    ]) {
      const rows = await scan;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r: any) => r.tenantId === "A")).toBe(true);
    }
  });
});

describe("Isolation tenant — API (get cross-tenant, registre)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("A ne peut pas lire l'entité juridique de B → 404", async () => {
    const created = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("BETA"), payload: { legalName: "BETA SAS", siren: "552100554" } });
    const betaId = created.json().id;
    const asA = await app.inject({ method: "GET", url: `/api/v1/companies/${betaId}`, headers: hrManager("ACME") });
    expect(asA.statusCode).toBe(404);
    const asB = await app.inject({ method: "GET", url: `/api/v1/companies/${betaId}`, headers: hrManager("BETA") });
    expect(asB.statusCode).toBe(200);
  });

  it("le registre d'un tenant ne contient jamais les collaborateurs d'un autre", async () => {
    // ACME embauche
    const cA = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("ACME"), payload: { legalName: "ACME SAS", siren: "552100554" } });
    const compA = cA.json().id;
    const eA = await app.inject({ method: "POST", url: `/api/v1/companies/${compA}/establishments`, headers: hrManager("ACME"), payload: { siret: "55210055400013", name: "Site Marseille" } });
    await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager("ACME"), payload: { person: { lastName: "Dupont", firstName: "Marie" }, legalEntityId: compA, administrativeEstablishmentId: eA.json().id, startDate: "2026-09-01", contractType: "CDI" } });
    // BETA embauche quelqu'un d'autre
    const cB = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin("BETA"), payload: { legalName: "BETA SAS", siren: "552100554" } });
    const compB = cB.json().id;
    const eB = await app.inject({ method: "POST", url: `/api/v1/companies/${compB}/establishments`, headers: hrManager("BETA"), payload: { siret: "55210055400013", name: "Site Lyon" } });
    await app.inject({ method: "POST", url: "/api/v1/employments", headers: hrManager("BETA"), payload: { person: { lastName: "Martin", firstName: "Jean" }, legalEntityId: compB, administrativeEstablishmentId: eB.json().id, startDate: "2026-09-01", contractType: "CDI" } });

    const regA = await app.inject({ method: "GET", url: `/api/v1/companies/${compA}/registry`, headers: hrManager("ACME") });
    const names = regA.json().map((r: any) => r.lastName);
    expect(names).toContain("Dupont");
    expect(names).not.toContain("Martin"); // aucune fuite depuis BETA
  });
});
