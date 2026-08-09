import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "crypto";
import { build } from "../src/app.js";
import { hrManager, signatory, employee, setupHire } from "./helpers.js";

describe("Coffre-fort documentaire (D10)", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("dépose un document scellé (SHA-256) et émet DocumentDeposited", async () => {
    const { personId } = await setupHire(app);
    const content = "CONTENU DU CONTRAT — Marie Dupont";
    const res = await app.inject({
      method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(),
      payload: { type: "CONTRACT", label: "Contrat CDI", content },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().sha256).toBe(createHash("sha256").update(content).digest("hex"));
    expect(app.bus.eventsOf("ACME", "DocumentDeposited").length).toBe(1);
  });

  it("vérifie l'intégrité WORM (empreinte inchangée)", async () => {
    const { personId } = await setupHire(app);
    const content = "preuve";
    const dep = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "OTHER", label: "x", content } });
    const doc = app.db.documents.find((d: any) => d.id === dep.json().id);
    // même contenu → empreinte identique ; contenu falsifié → différente
    expect(createHash("sha256").update(content).digest("hex")).toBe(doc.sha256);
    expect(createHash("sha256").update(content + "!").digest("hex")).not.toBe(doc.sha256);
  });

  it("un collaborateur (lecture seule) ne peut pas déposer → 403", async () => {
    const { personId } = await setupHire(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: employee(), payload: { type: "OTHER", label: "x", content: "y" } });
    expect(res.statusCode).toBe(403);
  });

  it("signature : RH demande, signataire signe ; RH ne peut pas signer", async () => {
    const { personId } = await setupHire(app);
    const dep = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/documents`, headers: hrManager(), payload: { type: "CONTRACT", label: "c", content: "abc" } });
    const id = dep.json().id;
    const reqSig = await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/request`, headers: hrManager(), payload: { signers: ["dg"] } });
    const otp = reqSig.json().challenge.otp; // OTP exposé en dev

    // RH ne peut pas signer (pas de document.sign) — refusé avant même l'OTP
    const denied = await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/sign`, headers: hrManager(), payload: { otp } });
    expect(denied.statusCode).toBe(403);

    // OTP invalide → refus
    const badOtp = await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/sign`, headers: signatory(), payload: { otp: "000000" } });
    expect(badOtp.statusCode).toBe(400);

    const ok = await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/sign`, headers: signatory(), payload: { otp } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().signatureStatus).toBe("SIGNED");
    expect(ok.json().signatureProof).toBeTruthy();
    expect(app.bus.eventsOf("ACME", "DocumentSigned").length).toBe(1);

    // signer deux fois → conflit
    const again = await app.inject({ method: "POST", url: `/api/v1/documents/${id}/signature/sign`, headers: signatory(), payload: { otp } });
    expect(again.statusCode).toBe(409);
  });
});
