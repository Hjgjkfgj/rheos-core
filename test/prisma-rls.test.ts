// Lot 10 — Preuve Row-Level Security en base RÉELLE. Ne s'exécute QUE sous
// STORE=prisma (skip en mémoire). Prouve : (1) avec RLS, le rôle applicatif ne
// voit que son tenant ; (2) NÉGATIF : sans RLS (rôle superutilisateur qui la
// contourne), l'isolation TOMBE ; (3) le rôle applicatif n'est pas superutilisateur ;
// (4) l'app refuse de démarrer en prod avec un superutilisateur.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { isSuperuser, assertNonSuperuserInProd, roleAttrs } from "../src/db-guard.js";

const RUN = process.env.STORE === "prisma";
const SIREN = "918273645"; // unique à ce test

describe.skipIf(!RUN)("RLS en base réelle (STORE=prisma)", () => {
  let app: any; // connexion via le rôle applicatif rheos_app (RLS effective)
  let adm: any; // connexion via le rôle admin/superutilisateur (RLS contournée)

  beforeAll(async () => {
    const { PrismaClient } = await import("@prisma/client");
    app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    adm = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
    // Même SIREN dans DEUX tenants distincts (insertion via superutilisateur → WITH CHECK contourné).
    for (const t of ["RLS-A", "RLS-B"]) {
      await adm.$executeRawUnsafe(
        `INSERT INTO "LegalEntity"(id,"tenantId","legalName",siren,status,"createdAt","updatedAt")
         VALUES (gen_random_uuid(),'${t}','ACME SAS','${SIREN}','ACTIVE',now(),now())`
      );
    }
  });

  afterAll(async () => {
    await adm?.$executeRawUnsafe(`DELETE FROM "LegalEntity" WHERE siren='${SIREN}'`);
    await app?.$disconnect(); await adm?.$disconnect();
  });

  it("AVEC RLS : le rôle applicatif ne voit que SON tenant", async () => {
    // set_config posé PAR TRANSACTION (équivaut à SET LOCAL) ; la requête n'a pas
    // de filtre tenantId → seule la RLS isole.
    const rows = await app.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${"RLS-A"}, true)`;
      return tx.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "LegalEntity" WHERE siren='${SIREN}'`);
    });
    expect(rows[0].c).toBe(1); // uniquement RLS-A
  });

  it("NÉGATIF : sans RLS (superutilisateur), l'isolation TOMBE", async () => {
    // Le superutilisateur contourne la RLS → il voit les DEUX tenants.
    const rows = await adm.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "LegalEntity" WHERE siren='${SIREN}'`);
    expect(rows[0].c).toBe(2); // fuite : preuve que c'est bien la RLS qui isole
  });

  it("chaque tenant ne voit QUE ses lignes (A≠B)", async () => {
    const seen = async (t: string) => (await app.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true)`;
      return tx.$queryRawUnsafe(`SELECT "tenantId" FROM "LegalEntity" WHERE siren='${SIREN}'`);
    })).map((r: any) => r.tenantId);
    expect(await seen("RLS-A")).toEqual(["RLS-A"]);
    expect(await seen("RLS-B")).toEqual(["RLS-B"]);
  });

  it("le rôle applicatif n'est PAS superutilisateur ; l'admin l'est", async () => {
    expect(await isSuperuser(app)).toBe(false);
    expect(await isSuperuser(adm)).toBe(true);
  });

  it("rheos_app ne CONTOURNE pas la RLS (NOBYPASSRLS) et ne peut PAS faire de DDL", async () => {
    const a = await roleAttrs(app);
    expect(a.superuser).toBe(false);
    expect(a.bypassRls).toBe(false); // échoue si le rôle bypasse la RLS
    // DDL interdit (aucun CREATE sur le schéma) → l'app ne peut pas migrer.
    await expect(app.$executeRawUnsafe(`CREATE TABLE ddl_forbidden_probe (x int)`)).rejects.toThrow();
  });

  it("l'app refuse de démarrer en PROD avec un superutilisateur", async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      await expect(assertNonSuperuserInProd(adm)).rejects.toThrow(/superutilisateur/i);
      await expect(assertNonSuperuserInProd(app)).resolves.toBeUndefined();
    } finally { process.env.NODE_ENV = prev; }
  });
});
