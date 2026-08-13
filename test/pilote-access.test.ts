// Recette pilote — lien magique d'accès collaborateur (remplace dev-token en prod).
// Le RH génère un jeton scopé à UNE personne (rôle Employee) → l'espace self-service.
import { describe, it, expect } from "vitest";
import { build } from "../src/app.js";
import { hrManager, employee, setupHire } from "./helpers.js";

describe("Accès collaborateur (lien magique)", () => {
  it("le RH génère un jeton scopé à la personne ; il ouvre SON espace", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/access-token`, headers: hrManager() });
    expect(res.statusCode).toBe(200);
    const { token, espaceUrl } = res.json();
    expect(espaceUrl).toMatch(/^\/espace#token=/);
    // Le jeton donne accès à /me (données de CETTE personne).
    const me = await app.inject({ method: "GET", url: "/api/v1/me", headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().employment).toBeTruthy();
  });

  it("refuse pour une personne d'un autre tenant → 404", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/access-token`, headers: hrManager("BETA") });
    expect(res.statusCode).toBe(404);
  });

  it("refuse sans le droit person.write → 403", async () => {
    const app: any = build();
    const { personId } = await setupHire(app);
    const res = await app.inject({ method: "POST", url: `/api/v1/persons/${personId}/access-token`, headers: employee() });
    expect(res.statusCode).toBe(403);
  });
});
