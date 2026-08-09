import { signToken } from "../src/jwt.js";
import { build } from "../src/app.js";

// --- Build store-aware (Lot 10) : sous STORE=prisma, l'app utilise le
// PrismaRepository (PostgreSQL + RLS) ; sinon le MemoryRepository. Permet de
// faire tourner l'acceptation D1/D2 en CI sur STORE=prisma.
let _prismaRepo: any;
let _admin: any;
export async function buildDB() {
  if (process.env.STORE === "prisma") {
    if (!_prismaRepo) {
      const { PrismaClient } = await import("@prisma/client");
      const { PrismaRepository } = await import("../src/prisma-repository.js");
      _prismaRepo = new PrismaRepository(new PrismaClient());
    }
    return build(_prismaRepo);
  }
  return build();
}

/// Réinitialise la base entre les tests (uniquement STORE=prisma) pour éviter la
/// pollution inter-tests (TRUNCATE via le rôle admin ; no-op en mémoire).
export async function resetDb() {
  if (process.env.STORE !== "prisma") return;
  if (!_admin) {
    const { PrismaClient } = await import("@prisma/client");
    _admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_ADMIN } } });
  }
  await _admin.$executeRawUnsafe(
    `DO $$ DECLARE r RECORD; BEGIN
       FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations' LOOP
         EXECUTE 'TRUNCATE TABLE '||quote_ident(r.tablename)||' RESTART IDENTITY CASCADE';
       END LOOP;
     END $$;`
  );
}

// Émet un vrai JWT (signé avec le même secret que l'app) → exerce le chemin de
// vérification Bearer. Après login, un client réel utilise exactement ce header.
const bearer = (p: { sub: string; tenantId: string; roles: string[]; personId?: string }) => ({
  authorization: `Bearer ${signToken(p)}`,
});

export const hrManager = (tenantId = "ACME") => bearer({ sub: "rh", tenantId, roles: ["HrManager"] });
export const signatory = (tenantId = "ACME") => bearer({ sub: "dg", tenantId, roles: ["Signatory"] });
export const tenantAdmin = (tenantId = "ACME") => bearer({ sub: "admin", tenantId, roles: ["TenantAdmin"] });
export const manager = (tenantId = "ACME") => bearer({ sub: "mgr", tenantId, roles: ["Manager"] });
export const employee = (tenantId = "ACME", personId = "p1") => bearer({ sub: "emp", tenantId, personId, roles: ["Employee"] });

export async function setupHire(app: any) {
  const c = await app.inject({ method: "POST", url: "/api/v1/companies", headers: tenantAdmin(), payload: { legalName: "ACME SAS", siren: "552100554" } });
  const companyId = c.json().id;
  const e = await app.inject({ method: "POST", url: `/api/v1/companies/${companyId}/establishments`, headers: hrManager(), payload: { siret: "55210055400013", name: "Site Marseille" } });
  const hire = await app.inject({
    method: "POST", url: "/api/v1/employments", headers: hrManager(),
    payload: { person: { lastName: "Dupont", firstName: "Marie" }, legalEntityId: companyId, administrativeEstablishmentId: e.json().id, startDate: "2026-09-01", contractType: "CDI" },
  });
  return { companyId, employmentId: hire.json().employment.id, personId: hire.json().employment.personId };
}
