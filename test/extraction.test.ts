import { describe, it, expect, beforeEach } from "vitest";
import { build } from "../src/app.js";
import { extractFields } from "../src/domain/extraction.js";
import { hrManager, employee } from "./helpers.js";

const SAMPLE = [
  "Jean MARTIN, né le 12/05/1990",
  "25 rue des Lilas, 13001 Marseille",
  "Téléphone : 06 62 43 47 37",
  "Email : jean.martin@example.fr",
  "IBAN : FR76 3000 4000 0312 3456 7890 143",
  "NIR : 1 90 05 13 001 042 12",
].join("\n");

describe("Extraction documentaire", () => {
  it("extrait les champs sans confondre IBAN/NIR avec le téléphone", () => {
    const f = extractFields(SAMPLE);
    expect(f.email).toBe("jean.martin@example.fr");
    expect(f.phone).toBe("0662434737");           // pas pollué par l'IBAN/NIR
    expect(f.iban).toBe("FR7630004000031234567890143");
    expect(f.nir).toBe("190051300104212");
    expect(f.postalCode).toBe("13001");
    expect(f.birthDate).toBe("1990-05-12");
  });

  it("téléphone correct même si l'IBAN précède (anti-faux-positif)", () => {
    const f = extractFields("IBAN FR76 3000 4000 0312 3456 7890 143 puis tel 0112345678");
    expect(f.phone).toBe("0112345678");
  });

  let app: any;
  beforeEach(() => { app = build(); });

  it("endpoint /extract renvoie les champs (droit person.write)", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/extract", headers: hrManager(), payload: { text: SAMPLE } });
    expect(res.statusCode).toBe(200);
    expect(res.json().fields.email).toBe("jean.martin@example.fr");
    expect(res.json().fields.phone).toBe("0662434737");
  });

  it("un collaborateur (sans person.write) ne peut pas extraire → 403", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/extract", headers: employee(), payload: { text: SAMPLE } });
    expect(res.statusCode).toBe(403);
  });
});
