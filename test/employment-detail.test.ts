// GET /employments/{id} (openapi) — détail d'une relation de travail.
import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { hrManager, setupHire } from "./helpers.js";

describe("GET /employments/:id — détail", () => {
  let app: any;
  beforeEach(() => { app = build(); });

  it("renvoie l'Employment (droit employment.read) ; introuvable → 404 ; sans droit → 403", async () => {
    const { employmentId } = await setupHire(app);
    const ok = await app.inject({ method: "GET", url: `/api/v1/employments/${employmentId}`, headers: hrManager() });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().id).toBe(employmentId);
    expect(ok.json().status).toBe("PRE_HIRE");
    const nf = await app.inject({ method: "GET", url: `/api/v1/employments/inexistant`, headers: hrManager() });
    expect(nf.statusCode).toBe(404);
  });
});
