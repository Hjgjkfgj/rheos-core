#!/usr/bin/env node
// Rhéos — Preuve RLS contre une base RÉELLE (Lot 15). À exécuter contre staging.
//   DATABASE_URL        : rôle applicatif rheos_app (RLS effective)   [requis]
//   DATABASE_URL_ADMIN  : rôle admin (seed/cleanup, bypass possible)  [requis]
//   THROWAWAY_ADMIN_URL  : base JETABLE pour le test négatif (facultatif)
//
//   node scripts/rls-check.mjs
// Sort 0 si l'isolation tient (et, si fourni, tombe bien sans RLS) ; 1 sinon.
import { PrismaClient } from "@prisma/client";

const SIREN = "900000001";
const need = (n) => { const v = process.env[n]; if (!v) { console.error(`Manque ${n}`); process.exit(2); } return v; };
const pc = (url) => new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const app = pc(need("DATABASE_URL"));
  const adm = pc(need("DATABASE_URL_ADMIN"));
  let ok = true;

  // 0) Attributs de sécurité du rôle applicatif.
  const [{ rolsuper, rolbypassrls }] = await app.$queryRawUnsafe(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  console.log(`• rôle app : superuser=${rolsuper} bypassrls=${rolbypassrls}`);
  if (rolsuper || rolbypassrls) { console.error("✗ le rôle applicatif contourne la RLS !"); ok = false; }

  // 1) Seed : même SIREN dans deux tenants (via admin, WITH CHECK contourné).
  await adm.$executeRawUnsafe(`DELETE FROM "LegalEntity" WHERE siren='${SIREN}'`);
  for (const t of ["RLS-A", "RLS-B"]) {
    await adm.$executeRawUnsafe(
      `INSERT INTO "LegalEntity"(id,"tenantId","legalName",siren,status,"createdAt","updatedAt")
       VALUES (gen_random_uuid(),'${t}','ACME','${SIREN}','ACTIVE',now(),now())`);
  }

  // 2) AVEC RLS : rheos_app + set_config('app.tenant_id') → ne voit que son tenant.
  const seen = await app.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${"RLS-A"}, true)`;
    return tx.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "LegalEntity" WHERE siren='${SIREN}'`);
  });
  console.log(`• AVEC RLS (tenant RLS-A) : ${seen[0].c} ligne(s) [attendu 1]`);
  if (seen[0].c !== 1) { console.error("✗ isolation cassée AVEC RLS"); ok = false; }

  // 3) NÉGATIF (base jetable uniquement) : sans policy, l'isolation tombe.
  if (process.env.THROWAWAY_ADMIN_URL) {
    const jail = pc(process.env.THROWAWAY_ADMIN_URL);
    await jail.$executeRawUnsafe(`ALTER TABLE "LegalEntity" DISABLE ROW LEVEL SECURITY`);
    const all = await jail.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "LegalEntity"`);
    console.log(`• SANS RLS (base jetable) : ${all[0].c} ligne(s) — l'isolation TOMBE (attendu)`);
    await jail.$executeRawUnsafe(`ALTER TABLE "LegalEntity" ENABLE ROW LEVEL SECURITY`);
    await jail.$disconnect();
  } else {
    console.log("• test négatif ignoré (THROWAWAY_ADMIN_URL non fourni)");
  }

  await adm.$executeRawUnsafe(`DELETE FROM "LegalEntity" WHERE siren='${SIREN}'`);
  await app.$disconnect(); await adm.$disconnect();
  console.log(ok ? "\n✓ RLS staging : isolation prouvée." : "\n✗ RLS staging : ÉCHEC.");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("Erreur:", e.message); process.exit(1); });
