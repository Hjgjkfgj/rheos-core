import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, employee, tenantAdmin } from "./helpers.js";

const iso = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

async function company(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  return c.json().id;
}

describe("Institutions & Pouvoirs publics (D9)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("enregistre un contrôle et le liste", async () => {
    const companyId = await company(app);
    const i = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/authority/interactions`, headers: hrManager(), payload: { authority: "INSPECTION_TRAVAIL", type: "CONTROLE", date: "2026-05-02", reference: "IT-2026-14" } });
    expect(i.statusCode).toBe(201);
    expect(i.json().status).toBe("OPEN");
    const list = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/authority/interactions`, headers: hrManager() });
    expect(list.json().length).toBe(1);
    expect(list.json()[0].authority).toBe("INSPECTION_TRAVAIL");
  });

  it("une échéance de réponse alimente la veille", async () => {
    const companyId = await company(app);
    await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/authority/interactions`, headers: hrManager(), payload: { authority: "URSSAF", type: "DEMANDE", date: iso(-2), dueDate: iso(10) } });
    const dl = await app.inject({ method: "GET", url: `/api/v1/companies/${companyId}/deadlines`, headers: hrManager() });
    const item = dl.json().items.find((x: any) => x.type === "AUTHORITY");
    expect(item).toBeTruthy();
    expect(item.status).toBe("DUE_SOON");
  });

  it("répondre passe l'interaction à RESPONDED", async () => {
    const companyId = await company(app);
    const i = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/authority/interactions`, headers: hrManager(), payload: { authority: "CARSAT", type: "COURRIER", date: "2026-05-02" } });
    const r = await app.inject({ method: "POST", url: `/api/v1/authority/interactions/${i.json().id}/respond`, headers: hrManager(), payload: { notes: "Réponse envoyée" } });
    expect(r.json().status).toBe("RESPONDED");
    expect(r.json().responseDate).toBeTruthy();
  });

  it("un collaborateur ne peut pas créer d'interaction → 403", async () => {
    const companyId = await company(app);
    const i = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/authority/interactions`, headers: employee(), payload: { authority: "URSSAF", type: "DEMANDE", date: "2026-05-02" } });
    expect(i.statusCode).toBe(403);
  });
});
