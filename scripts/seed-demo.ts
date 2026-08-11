// Seed de démonstration multi-secteurs (Lot 8) — données SYNTHÉTIQUES.
// Respecte le store sélectionné (STORE=memory par défaut, STORE=prisma pour peupler
// PostgreSQL). Vocabulaire officiel : « collaborateur » (jamais « salarié »).
//   Usage :  npx tsx scripts/seed-demo.ts        (mémoire, éphémère)
//            STORE=prisma npx tsx scripts/seed-demo.ts   (persiste en base)
import { build } from "../src/app.js";
import { getRepository } from "../src/store-selector.js";
import { signToken } from "../src/jwt.js";

// Fixe le secret JWT du seed AVANT toute signature. Les jetons ne servent qu'à appeler
// l'app en interne (app.inject). Sans ça, les jetons sont signés avec le repli
// "dev-secret-change-me", puis PrismaClient charge .env et change process.env.JWT_SECRET
// → la vérification échoue (401 signature invalide). On le verrouille ici (dotenv ne
// surcharge pas une variable déjà définie).
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "seed-demo-secret";

const TENANT = "DEMO";
const admin = { authorization: `Bearer ${signToken({ sub: "admin", tenantId: TENANT, roles: ["TenantAdmin"], scopes: [{ type: "TENANT" }] })}` };
const hr = { authorization: `Bearer ${signToken({ sub: "rh", tenantId: TENANT, roles: ["HrManager"] })}` };

const FIRST = ["Camille", "Louis", "Sofia", "Yanis", "Léa", "Noah", "Inès", "Hugo", "Nour", "Adam", "Jade", "Gabin"];
const LAST = ["Martin", "Bernard", "Dubois", "Robert", "Petit", "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Garcia", "Roux"];
const CONTRACTS = ["CDI", "CDI", "CDI", "CDD", "APPRENTICESHIP"]; // majorité CDI

async function main() {
  const repo = await getRepository();
  const app = build(repo);
  const post = async (url: string, payload: any, headers = admin) => {
    const res = await app.inject({ method: "POST", url, headers, payload });
    if (res.statusCode >= 300) throw new Error(`POST ${url} → HTTP ${res.statusCode} : ${res.body}`);
    return res.json();
  };

  let seq = 0;
  const person = () => ({ lastName: LAST[seq % LAST.length], firstName: FIRST[(seq++) % FIRST.length] });

  async function company(name: string, siren: string, sites: { siret: string; name: string }[], headcount: number) {
    const co = await post("/api/v1/companies", { legalName: name, siren });
    const estIds: string[] = [];
    for (const s of sites) estIds.push((await post(`/api/v1/companies/${co.id}/establishments`, s, hr)).id);
    for (let i = 0; i < headcount; i++) {
      await post("/api/v1/employments", {
        person: person(), legalEntityId: co.id, administrativeEstablishmentId: estIds[i % estIds.length],
        startDate: "2026-01-05", contractType: CONTRACTS[i % CONTRACTS.length], grossMonthly: 1900 + (i % 5) * 120, workingTime: 35,
      }, hr);
    }
    return { name, id: co.id, establishments: estIds.length, headcount };
  }

  const results = [];
  // 1) Boulangerie — 8 collaborateurs, 1 établissement
  results.push(await company("Boulangerie du Vieux-Port", "552100554",
    [{ siret: "55210055400013", name: "Fournil Marseille" }], 8));
  // 2) Restaurant — 38 collaborateurs, 3 établissements (franchissement seuils 11/20)
  results.push(await company("Groupe Le Comptoir", "552100562",
    [{ siret: "55210056200011", name: "Le Comptoir Vieux-Port" }, { siret: "55210056200029", name: "Le Comptoir Prado" }, { siret: "55210056200037", name: "Le Comptoir Aix" }], 38));
  // 3) PME multi-sites — 60 collaborateurs, 2 établissements (franchissement seuil 50)
  results.push(await company("Provence Services SAS", "552100570",
    [{ siret: "55210057000015", name: "Siège Marseille" }, { siret: "55210057000023", name: "Agence Aix" }], 60));

  for (const r of results) {
    const obs = (await app.inject({ method: "GET", url: `/api/v1/companies/${r.id}/obligations`, headers: hr })).json();
    const obsCount = Array.isArray(obs) ? obs.length : (obs.items?.length ?? "?");
    console.log(`✓ ${r.name} — ${r.headcount} collaborateur(s), ${r.establishments} établissement(s), ${obsCount} obligation(s) déclenchée(s)`);
  }
  console.log(`\nSeed « ${TENANT} » terminé (STORE=${process.env.STORE ?? "memory"}).`);
}

main().catch((e) => { console.error("Seed échoué :", e); process.exit(1); });
