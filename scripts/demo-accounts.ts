// Active / désactive les comptes de DÉMONSTRATION (tenant DEMO) en base.
// Le mode démo n'existe plus dans l'interface publique (Lot UI-1c) : ces comptes ne
// servent qu'à rejouer une démo prospect, à la demande, puis à refermer l'accès.
// Les DONNÉES du tenant DEMO restent en base dans tous les cas.
//
// Usage :
//   STORE=prisma DATABASE_URL="<admin-url>" DEMO_PASSWORD='…' npm run demo:enable   # (mdp requis à la 1re création)
//   STORE=prisma DATABASE_URL="<admin-url>" npm run demo:disable
//
// Le mot de passe (DEMO_PASSWORD) n'est lu qu'à la CRÉATION initiale, via l'environnement —
// jamais en argument, jamais affiché ni loggé. La réactivation ultérieure ne le redemande pas.
import { getRepository } from "../src/store-selector.js";
import { AuthService } from "../src/auth-service.js";

const DEMO_TENANT = "DEMO";
const DEMO_ACCOUNTS: { email: string; roleNames: string[] }[] = [
  { email: "admin@demo", roleNames: ["TenantAdmin"] },
  { email: "dg@demo", roleNames: ["Signatory"] },
];

async function main() {
  const mode = process.argv[2];
  if (mode !== "enable" && mode !== "disable") {
    console.error("✗ usage : npm run demo:enable | npm run demo:disable"); process.exit(1);
  }
  const repo = await getRepository();
  const auth = new AuthService(repo);
  const password = process.env.DEMO_PASSWORD ?? "";
  const report: string[] = [];

  for (const acc of DEMO_ACCOUNTS) {
    const existing = await repo.getAuthAccountByEmail(acc.email);
    if (mode === "enable") {
      if (existing) {
        await repo.updateAuthAccount(existing.id, { disabled: false });
        report.push(`réactivé   : ${acc.email}`);
      } else {
        if (!password) { console.error(`✗ DEMO_PASSWORD requis pour créer ${acc.email} (1re activation)`); process.exit(1); }
        await auth.createAccount({ email: acc.email, tenantId: DEMO_TENANT, roleNames: acc.roleNames, password });
        report.push(`créé       : ${acc.email} (${acc.roleNames.join(", ")})`);
      }
    } else {
      if (existing) { await repo.updateAuthAccount(existing.id, { disabled: true }); report.push(`désactivé  : ${acc.email}`); }
      else report.push(`absent     : ${acc.email} (rien à faire)`);
    }
  }

  console.log(`✓ Démo ${mode === "enable" ? "ACTIVÉE" : "DÉSACTIVÉE"} (tenant ${DEMO_TENANT}) :`);
  for (const line of report) console.log("  " + line);
  console.log(mode === "enable"
    ? "  → l'accès démo est ouvert ; pense à le refermer avec npm run demo:disable après la démo."
    : "  → plus aucun compte démo actif ; les données du tenant DEMO restent en base.");
  process.exit(0);
}

main().catch((e) => { console.error("✗ " + (e?.message ?? e)); process.exit(1); });
