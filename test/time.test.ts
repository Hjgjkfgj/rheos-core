import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, manager, employee, setupHire } from "./helpers.js";

describe("Socle Temps — congés (D3)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("le collaborateur demande, le manager approuve, le solde diminue", async () => {
    const { employmentId } = await setupHire(app);

    const bal0 = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/leave-balance?type=PAID`, headers: manager() });
    expect(bal0.json().remaining).toBe(30); // droit annuel ouvrables (spec validée)

    const req = await app.inject({
      method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(),
      payload: { type: "PAID", startDate: "2026-12-01", endDate: "2026-12-05" }, // 5 jours inclusifs
    });
    expect(req.statusCode).toBe(201);
    expect(req.json().days).toBe(5);
    expect(req.json().status).toBe("REQUESTED");

    const appr = await app.inject({ method: "POST", url: `/api/v1/leave-requests/${req.json().id}/approve`, headers: manager() });
    expect(appr.statusCode).toBe(200);
    expect(appr.json().status).toBe("APPROVED");

    const bal1 = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/leave-balance?type=PAID`, headers: manager() });
    expect(bal1.json().remaining).toBe(25); // 30 acquis − 5 pris
    expect(app.bus.eventsOf("ACME", "LeaveApproved").length).toBe(1);
  });

  it("refuse une demande dépassant le solde → 409", async () => {
    const { employmentId } = await setupHire(app);
    const req = await app.inject({
      method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(),
      payload: { type: "PAID", startDate: "2026-06-01", endDate: "2026-08-31" }, // > 30 j ouvrables → dépasse le solde
    });
    const appr = await app.inject({ method: "POST", url: `/api/v1/leave-requests/${req.json().id}/approve`, headers: manager() });
    expect(appr.statusCode).toBe(409);
  });

  it("un collaborateur ne peut pas approuver → 403", async () => {
    const { employmentId } = await setupHire(app);
    const req = await app.inject({
      method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(),
      payload: { type: "PAID", startDate: "2026-12-01", endDate: "2026-12-02" },
    });
    const appr = await app.inject({ method: "POST", url: `/api/v1/leave-requests/${req.json().id}/approve`, headers: employee() });
    expect(appr.statusCode).toBe(403);
  });

  it("refuser explicitement une demande", async () => {
    const { employmentId } = await setupHire(app);
    const req = await app.inject({
      method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(),
      payload: { type: "PAID", startDate: "2026-12-01", endDate: "2026-12-02" },
    });
    const ref = await app.inject({ method: "POST", url: `/api/v1/leave-requests/${req.json().id}/refuse`, headers: hrManager() });
    expect(ref.statusCode).toBe(200);
    expect(ref.json().status).toBe("REFUSED");
  });
});
