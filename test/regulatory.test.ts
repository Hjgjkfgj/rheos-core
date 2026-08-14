// R1 — Référentiel réglementaire (ADR-020). Ingestion idempotente, détection de
// changement, exposition partagée entre tenants, absence de mutation côté tenant.
import { describe, it, expect } from "vitest";
import { build } from "../src/app.js";
import { hrManager, tenantAdmin } from "./helpers.js";
import { RegulatoryService } from "../src/services-regulatory.js";

const svcOf = (app: any) => new RegulatoryService(app.db, app.bus);

describe("Référentiel réglementaire (R1)", () => {
  it("ingestion IDEMPOTENTE : même contenu → aucune nouvelle version, hash identique", async () => {
    const app: any = build(); const svc = svcOf(app);
    const a = await svc.ingestText({ idcc: "1979", kaliId: "K1", title: "HCR", content: "texte v1" });
    const b = await svc.ingestText({ idcc: "1979", kaliId: "K1", title: "HCR", content: "texte v1" });
    expect(a).toMatchObject({ changed: true, version: 1 });
    expect(b).toMatchObject({ changed: false, version: 1 });
    expect(b.hash).toBe(a.hash);
    expect(app.db.regulatoryTexts.filter((t: any) => t.idcc === "1979")).toHaveLength(1); // pas de doublon
  });

  it("détecte un CHANGEMENT → nouvelle version + événement RegulatoryTextUpdated", async () => {
    const app: any = build(); const svc = svcOf(app);
    await svc.ingestText({ idcc: "1979", kaliId: "K1", title: "HCR", content: "v1" });
    const c = await svc.ingestText({ idcc: "1979", kaliId: "K1", title: "HCR", content: "v2 modifié" });
    expect(c).toMatchObject({ changed: true, version: 2 });
    expect(app.bus.eventsOf("PLATFORM", "RegulatoryTextUpdated")).toHaveLength(2);
  });

  it("exposition lecture PARTAGÉE : deux tenants voient le MÊME référentiel", async () => {
    const app: any = build(); const svc = svcOf(app);
    await svc.ingestText({ idcc: "2216", kaliId: "K2", title: "Commerce alimentaire", effectiveDate: "2005-07-07", content: "txt", sourceUrl: "https://www.legifrance.gouv.fr/affichIDCC.do?idConvention=KALICONT000005635085", sourceName: "KALI" });
    const asA = (await app.inject({ method: "GET", url: "/api/v1/regulatory/agreements/2216", headers: hrManager("A") })).json();
    const asB = (await app.inject({ method: "GET", url: "/api/v1/regulatory/agreements/2216", headers: hrManager("B") })).json();
    expect(asA.currentText.version).toBe(1);
    expect(asA.currentText.effectiveDate).toBe("2005-07-07");
    expect(asA.source.name).toBe("KALI");
    expect(asA).toEqual(asB); // référentiel plateforme : identique pour tous les tenants
  });

  it("ISOLATION : aucune route de MUTATION du référentiel exposée à un tenant", async () => {
    const app: any = build();
    // Seule la lecture (GET) existe ; toute tentative de mutation → 404 (route inexistante).
    for (const m of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      expect((await app.inject({ method: m, url: "/api/v1/regulatory/agreements/1979", headers: tenantAdmin() })).statusCode).toBe(404);
    }
  });

  it("règles : seules les PUBLISHED sont exposées", async () => {
    const app: any = build(); const svc = svcOf(app);
    await svc.ingestText({ idcc: "1979", kaliId: "K1", title: "HCR", content: "t" });
    await svc.upsertRule({ id: "r1", idcc: "1979", type: "PROBATION", params: { months: 2 }, effectiveFrom: "2020-01-01", sourceRef: "Convention HCR, art. X (avenant 2019)", status: "PUBLISHED", publishedAt: "2020-01-01" });
    await svc.upsertRule({ id: "r2", idcc: "1979", type: "NOTICE", params: { days: 30 }, effectiveFrom: "2020-01-01", sourceRef: "art. Y", status: "PROPOSED" });
    const ag = (await app.inject({ method: "GET", url: "/api/v1/regulatory/agreements/1979", headers: hrManager() })).json();
    expect(ag.publishedRules).toHaveLength(1);
    expect(ag.publishedRules[0].type).toBe("PROBATION");
    expect(ag.publishedRules[0].sourceRef).toContain("art.");
  });
});
