// Lot 16 — Import massif & export miroir. Critères de sortie : un CSV de 50
// collaborateurs s'importe (< 1 min) avec rapport ; le re-jeu ne double rien ;
// cas limites (vide, colonnes manquantes, encodages UTF-8/Latin-1, 1000 lignes).
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { tenantAdmin, hrManager } from "./helpers.js";

const HEAD = "Nom,Prénom,Date de naissance,Date d'entrée,Type de contrat,Rémunération brute mensuelle (€)";

async function makeCompany(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  return companyId;
}
const preview = (app: any, id: string, body: any) => app.inject({ method: "POST", url: `/api/v1/companies/${id}/import/preview`, headers: hrManager(), payload: body });
const commit = (app: any, id: string, body: any) => app.inject({ method: "POST", url: `/api/v1/companies/${id}/import/commit`, headers: hrManager(), payload: body });
const gen = (n: number) => [HEAD, ...Array.from({ length: n }, (_, i) => `Nom${i},Prenom${i},1990-01-01,2026-01-06,CDI,2000`)].join("\n");

describe("Import — mapping, validation, cascade", () => {
  let app: any, companyId: string;
  beforeEach(async () => { app = build(); companyId = await makeCompany(app); });

  it("mappe les colonnes, valide et importe (cascade Person→Employment→Contrat DRAFT)", async () => {
    const content = [HEAD,
      "Dupont,Marie,1990-05-12,2026-01-06,CDI,2100",
      "Martin,Jean,12/03/1985,2026-02-01,CDD,1950",   // date FR JJ/MM/AAAA tolérée
    ].join("\n");
    const p = (await preview(app, companyId, { content, filename: "x.csv" })).json();
    expect(p.summary).toMatchObject({ total: 2, rejected: 0, review: 0, skipped: 0 });
    expect(p.mapping).toHaveProperty("lastName");
    expect(p.mapping).toHaveProperty("startDate");

    const r = (await commit(app, companyId, { content })).json();
    expect(r.summary.imported).toBe(2);
    const emps = app.db.employments.filter((e: any) => e.tenantId === "ACME");
    expect(emps).toHaveLength(2);
    const contracts = app.db.contracts.filter((c: any) => c.tenantId === "ACME");
    expect(contracts.length).toBe(2);
    expect(contracts.every((c: any) => c.status === "DRAFT")).toBe(true); // brouillon, non signé
    expect(app.bus.eventsOf("ACME", "CollaboratorsImported").length).toBe(1); // événement audité
  });

  it("importe 50 collaborateurs avec rapport (critère de sortie)", async () => {
    const r = (await commit(app, companyId, { content: gen(50), filename: "lot50.csv" })).json();
    expect(r.summary).toMatchObject({ total: 50, imported: 50, review: 0, rejected: 0, skipped: 0 });
    expect(app.db.employments.filter((e: any) => e.tenantId === "ACME")).toHaveLength(50);
  });

  it("IDEMPOTENT : re-jouer le même fichier ne crée aucun doublon", async () => {
    const content = gen(50);
    const first = (await commit(app, companyId, { content })).json();
    expect(first.summary.imported).toBe(50);
    const second = (await commit(app, companyId, { content })).json();
    expect(second.summary.imported).toBe(0);
    expect(second.summary.skipped).toBe(50); // tous déjà présents → ignorés
    expect(app.db.employments.filter((e: any) => e.tenantId === "ACME")).toHaveLength(50); // toujours 50
  });

  it("classe rejets, à-vérifier et importables", async () => {
    const content = [HEAD,
      "Ok,Valide,1990-05-12,2026-01-06,CDI,2100",               // toImport
      "Sans,Contrat,1990-05-12,2026-01-06,,2100",               // rejected (type manquant)
      "Date,Illisible,1990-05-12,32/13/2026,CDI,2100",          // rejected (date invalide)
      "Ok,Valide,1990-05-12,2026-01-06,CDI,2100",               // review (doublon dans le fichier)
      "Futur,Bebe,2030-01-01,2026-01-06,CDI,2100",              // review (naissance future)
    ].join("\n");
    const p = (await preview(app, companyId, { content })).json();
    expect(p.summary).toMatchObject({ total: 5, rejected: 2, review: 2 });
    // Le commit n'écrit que la ligne conforme.
    const r = (await commit(app, companyId, { content })).json();
    expect(r.summary.imported).toBe(1);
  });

  it("respecte le dédoublonnage face à l'existant (nom+prénom+naissance)", async () => {
    await commit(app, companyId, { content: [HEAD, "Neuf,Unique,1992-03-04,2026-01-06,CDI,2000"].join("\n") });
    const again = (await commit(app, companyId, { content: [HEAD, "Neuf,Unique,1992-03-04,2026-02-01,CDD,1900"].join("\n") })).json();
    expect(again.summary.imported).toBe(0);
    expect(again.summary.skipped).toBe(1);
  });
});

describe("Import — cas limites", () => {
  let app: any, companyId: string;
  beforeEach(async () => { app = build(); companyId = await makeCompany(app); });

  it("fichier vide → 400", async () => {
    const res = await preview(app, companyId, { content: "" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("empty_file");
  });

  it("colonnes obligatoires manquantes → 422", async () => {
    const res = await preview(app, companyId, { content: "Nom,Prénom\nDupont,Marie" });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("missing_columns");
  });

  it("encodage UTF-8 : accents préservés", async () => {
    const content = [HEAD, "Bernàrd,Inès,1998-11-23,2026-01-15,Apprentissage,900"].join("\n");
    const p = (await preview(app, companyId, { content })).json();
    expect(p.rows[0].record.firstName).toBe("Inès");
    expect(p.rows[0].record.lastName).toBe("Bernàrd");
    expect(p.rows[0].record.contractType).toBe("APPRENTICESHIP"); // synonyme FR reconnu
  });

  it("encodage Latin-1 détecté et décodé", async () => {
    const head = "Nom,Prénom,Date de naissance,Date d'entrée,Type de contrat,Salaire brut";
    const csv = [head, "Bernàrd,Inès,1998-11-23,2026-01-15,CDI,2000"].join("\n");
    const fileBase64 = Buffer.from(csv, "latin1").toString("base64");
    const p = (await preview(app, companyId, { fileBase64, filename: "latin1.csv" })).json();
    expect(p.meta.encoding).toBe("latin1");
    expect(p.rows[0].record.firstName).toBe("Inès");
  });

  it("rejette un .xlsx avec un message d'aide", async () => {
    const fileBase64 = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]).toString("base64"); // signature ZIP (PK)
    const res = await preview(app, companyId, { fileBase64, filename: "collab.xlsx" });
    expect(res.statusCode).toBe(415);
    expect(res.json().message).toMatch(/CSV/i);
  });

  it("1000 lignes s'importent (performance)", async () => {
    const r = (await commit(app, companyId, { content: gen(1000) })).json();
    expect(r.summary.imported).toBe(1000);
  });
});

describe("Export miroir (réversibilité / RGPD)", () => {
  it("exporte les collaborateurs en CSV et en JSON", async () => {
    const app = build();
    const companyId = await makeCompany(app);
    await commit(app, companyId, { content: [HEAD,
      "Dupont,Marie,1990-05-12,2026-01-06,CDI,2100",
      "Martin,Jean,1985-03-12,2026-02-01,CDD,1950",
    ].join("\n") });

    const json = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/collaborators/export?format=json`, headers: hrManager() });
    const arr = json.json();
    expect(Array.isArray(arr)).toBe(true);
    expect(arr).toHaveLength(2);
    expect(arr[0]).toHaveProperty("lastName");
    expect(arr[0]).toHaveProperty("contractType");

    const csv = await app.inject({ method: "GET", url: `/api/v1/collaborators/export?format=csv`, headers: hrManager() });
    expect(csv.headers["content-type"]).toMatch(/text\/csv/);
    expect(csv.body).toContain("Nom");
    expect(csv.body).toContain("Dupont");
  });
});
