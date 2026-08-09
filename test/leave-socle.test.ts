// Socle Temps — absences/congés/compteurs (spec docs/spec-absences.md, validée).
// Critères de sortie : cycle demande→approbation→solde→variable de paie ; recalcul
// d'un solde passé via l'historique (ledger append-only). + décompte, corrections.
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, manager, employee, setupHire } from "./helpers.js";
import { countLeaveDays } from "../src/domain/leave.js";

const req = (app: any, employmentId: string, body: any) =>
  app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/leave-requests`, headers: employee(), payload: body });
const approve = (app: any, id: string) =>
  app.inject({ method: "POST", url: `/api/v1/leave-requests/${id}/approve`, headers: manager() });
const balance = (app: any, employmentId: string, asOf?: string) =>
  app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/leave-balance?type=PAID${asOf ? `&asOf=${asOf}` : ""}`, headers: manager() });

describe("Socle Temps — cycle complet & variable de paie", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("demande → approbation → solde décrémenté → variable de paie (jours)", async () => {
    const { employmentId } = await setupHire(app);
    // CP du 5 au 9 octobre 2026 (lun→ven) = 5 jours ouvrables
    const r = await req(app, employmentId, { type: "PAID", startDate: "2026-10-05", endDate: "2026-10-09" });
    expect(r.json().days).toBe(5);
    expect(r.json().status).toBe("REQUESTED");
    const a = await approve(app, r.json().id);
    expect(a.json().status).toBe("APPROVED");
    expect(app.bus.eventsOf("ACME", "LeaveApproved").length).toBe(1);
    // solde décrémenté (30 acquis − 5 pris)
    expect((await balance(app, employmentId)).json().remaining).toBe(25);
    // consommé par la préparation de variables de paie (octobre 2026)
    const pay = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/payroll-input?year=2026&month=10`, headers: hrManager() });
    expect(pay.json().leaves.find((l: any) => l.type === "PAID").days).toBe(5);
  });

  it("un congé sans solde approuvé produit une variable « jours non rémunérés »", async () => {
    const { employmentId } = await setupHire(app);
    const r = await req(app, employmentId, { type: "UNPAID", startDate: "2026-10-06", endDate: "2026-10-08" }); // 3 ouvrables
    await approve(app, r.json().id);
    const pay = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}/payroll-input?year=2026&month=10`, headers: hrManager() });
    expect(pay.json().unpaidDays).toBe(3);
  });
});

describe("Socle Temps — décompte ouvrables (fériés) & ouvrés/ouvrables", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("un jour férié chômé dans la période décompte un jour de moins", async () => {
    const { employmentId } = await setupHire(app);
    // 13→15 juillet 2026 : le 14 (fête nationale) est chômé → 2 jours au lieu de 3
    const withHoliday = await req(app, employmentId, { type: "PAID", startDate: "2026-07-13", endDate: "2026-07-15" });
    expect(withHoliday.json().days).toBe(2);
    const noHoliday = await req(app, employmentId, { type: "PAID", startDate: "2026-07-20", endDate: "2026-07-22" });
    expect(noHoliday.json().days).toBe(3);
  });

  it("le mode ouvrés exclut le samedi, le mode ouvrables l'inclut", () => {
    // lundi 5 → samedi 10 octobre 2026
    expect(countLeaveDays("2026-10-05", "2026-10-10", { mode: "OUVRABLES" })).toBe(6); // + samedi
    expect(countLeaveDays("2026-10-05", "2026-10-10", { mode: "OUVRES" })).toBe(5);    // − samedi
  });
});

describe("Socle Temps — historique append-only & recalcul de solde passé", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("le solde à une date passée se reconstruit depuis le ledger (inchangé par les mouvements ultérieurs)", async () => {
    const { employmentId } = await setupHire(app);
    const r = await req(app, employmentId, { type: "PAID", startDate: "2026-10-05", endDate: "2026-10-09" }); // effet 2026-10-05
    await approve(app, r.json().id);
    // avant la prise d'effet → solde plein
    expect((await balance(app, employmentId, "2026-09-01")).json().remaining).toBe(30);
    // après → décrémenté
    expect((await balance(app, employmentId, "2026-10-31")).json().remaining).toBe(25);
  });

  it("une correction est une NOUVELLE ligne (append-only) ; le mouvement TAKEN d'origine est conservé", async () => {
    const { employmentId } = await setupHire(app);
    const r = await req(app, employmentId, { type: "PAID", startDate: "2026-10-05", endDate: "2026-10-09" });
    await approve(app, r.json().id);
    // correction +2 (ex. régularisation d'ancienneté)
    await app.inject({ method: "POST", url: `/api/v1/employments/${employmentId}/leave-corrections`, headers: manager(), payload: { type: "PAID", days: 2, effectiveDate: "2026-10-10", reason: "régularisation" } });
    const ledger = app.db.leaveLedger.filter((e: any) => e.employmentId === employmentId);
    expect(ledger.filter((e: any) => e.kind === "TAKEN")[0].days).toBe(5);   // TAKEN inchangé
    expect(ledger.filter((e: any) => e.kind === "CORRECTION")[0].days).toBe(2);
    expect(ledger.length).toBe(2); // deux lignes distinctes, aucun écrasement
    // 30 acquis − 5 pris + 2 correction
    expect((await balance(app, employmentId)).json().remaining).toBe(27);
  });
});
