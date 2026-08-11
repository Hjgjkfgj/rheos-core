#!/usr/bin/env node
// Rhéos — Preuve RLS contre une base RÉELLE (Lot 15). À exécuter contre staging.
//   DATABASE_URL        : rôle applicatif rheos_app (RLS effective)   [requis]
//   DATABASE_URL_ADMIN  : rôle admin/owner (seed/cleanup)             [requis]
//   THROWAWAY_ADMIN_URL : base JETABLE SANS policies (test négatif)   [facultatif]
//
//   node scripts/rls-check.mjs
// Sort 0 si l'isolation tient (A ne voit que A, B que B, rien sans tenant) ; 1 sinon.
//
// Note Scaleway : l'admin (owner) n'est ni superuser ni BYPASSRLS et les tables
// sont en FORCE ROW LEVEL SECURITY → même l'owner est soumis à la RLS. Le seed et
// le cleanup posent donc app.tenant_id par transaction (ce qui prouve, en prime,
// que FORCE s'applique bien à l'owner).
import { PrismaClient } from "@prisma/client";

const SIREN = "900000001";
const TENANTS = ["RLS-A", "RLS-B"];
const need = (n) => { const v = process.env[n]; if (!v) { console.error(`Manque ${n}`); process.exit(2); } return v; };
const pc = (url) => new PrismaClient({ datasources: { db: { url } } });

// Écrit dans le contexte d'un tenant (owner soumis à FORCE RLS → WITH CHECK exige le tenant).
const inTenant = (client, tenant, sql) => client.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenant}, true)`;
  return tx.$queryRawUnsafe(sql);
});

const cleanup = async (adm) => {
  for (const t of TENANTS) {
    await adm.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx.$executeRawUnsafe(`DELETE FROM "LegalEntity" WHERE siren='${SIREN}'`);
    });
  }
};

async function main() {
  const app = pc(need("DATABASE_URL"));
  const adm = pc(need("DATABASE_URL_ADMIN"));
  let ok = true;
  const fail = (m) => { console.error(`✗ ${m}`); ok = false; };

  // 0) Attributs de sécurité du rôle applicatif : ni superuser, ni bypass RLS.
  const [{ rolsuper, rolbypassrls }] = await app.$queryRawUnsafe(
    `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  console.log(`• rôle app : superuser=${rolsuper} bypassrls=${rolbypassrls} [attendu false/false]`);
  if (rolsuper || rolbypassrls) fail("le rôle applicatif contourne la RLS !");

  // 1) Seed : même SIREN dans deux tenants (admin owner, tenant posé par transaction).
  await cleanup(adm);
  for (const t of TENANTS) {
    await adm.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx.$executeRawUnsafe(
        `INSERT INTO "LegalEntity"(id,"tenantId","legalName",siren,status,"createdAt","updatedAt")
         VALUES (gen_random_uuid(),'${t}','ACME','${SIREN}','ACTIVE',now(),now())`);
    });
  }

  // 2) POSITIF : rheos_app dans le tenant RLS-A ne voit QUE la ligne de RLS-A.
  const a = await inTenant(app, "RLS-A", `SELECT "tenantId" AS t FROM "LegalEntity" WHERE siren='${SIREN}'`);
  console.log(`• tenant RLS-A voit : [${a.map((r) => r.t).join(", ")}] [attendu RLS-A]`);
  if (a.length !== 1 || a[0].t !== "RLS-A") fail("le tenant A ne voit pas exactement sa ligne");

  // 3) NÉGATIF (deny) : depuis RLS-B, la ligne de RLS-A est INVISIBLE (et inversement).
  const b = await inTenant(app, "RLS-B", `SELECT "tenantId" AS t FROM "LegalEntity" WHERE siren='${SIREN}'`);
  console.log(`• tenant RLS-B voit : [${b.map((r) => r.t).join(", ")}] [attendu RLS-B]`);
  if (b.length !== 1 || b[0].t !== "RLS-B") fail("le tenant B voit une ligne d'un autre tenant (fuite) !");

  // 4) NÉGATIF (aucun contexte) : sans app.tenant_id, la RLS masque tout.
  const none = await app.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "LegalEntity" WHERE siren='${SIREN}'`);
  console.log(`• sans tenant : ${none[0].c} ligne(s) [attendu 0]`);
  if (none[0].c !== 0) fail("des lignes fuient sans contexte de tenant !");

  // 5) MÉTA-NÉGATIF (base jetable SANS policies) : l'isolation tombe → prouve que
  //    c'est bien la RLS qui isole (le test n'est pas un faux positif).
  if (process.env.THROWAWAY_ADMIN_URL) {
    const jail = pc(process.env.THROWAWAY_ADMIN_URL);
    for (const t of TENANTS) {
      await jail.$executeRawUnsafe(
        `INSERT INTO "LegalEntity"(id,"tenantId","legalName",siren,status,"createdAt","updatedAt")
         VALUES (gen_random_uuid(),'${t}','ACME','${SIREN}','ACTIVE',now(),now())`);
    }
    const all = await jail.$queryRawUnsafe(`SELECT count(*)::int AS c FROM "LegalEntity" WHERE siren='${SIREN}'`);
    console.log(`• base jetable SANS RLS : ${all[0].c} ligne(s) visibles — l'isolation TOMBE (attendu 2)`);
    if (all[0].c < 2) fail("le méta-test négatif n'a pas exposé les 2 tenants");
    await jail.$executeRawUnsafe(`DELETE FROM "LegalEntity" WHERE siren='${SIREN}'`);
    await jail.$disconnect();
  } else {
    console.log("• méta-test négatif ignoré (THROWAWAY_ADMIN_URL non fourni)");
  }

  await cleanup(adm);
  await app.$disconnect(); await adm.$disconnect();
  console.log(ok ? "\n✓ RLS staging : isolation prouvée (A≠B, deny hors contexte)." : "\n✗ RLS staging : ÉCHEC.");
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error("Erreur:", e.message); process.exit(1); });
