// Crée un compte d'authentification PERSISTANT (table AuthAccount).
// Le mot de passe est lu dans la variable d'environnement USER_PASSWORD —
// JAMAIS en argument (visible dans l'historique/ps), JAMAIS affiché ni loggé.
//
// Usage :
//   STORE=prisma DATABASE_URL="<admin-url>" USER_PASSWORD='…' \
//     npm run user:create -- --email admin@moncompte.fr --role TenantAdmin --tenant RHEOS
//
// Options :
//   --email   <email>                (obligatoire, unique)
//   --role    <R1,R2,…>              (obligatoire ; rôles standard, cf. auth.ts)
//   --tenant  <tenantId>             (obligatoire)
//   --person  <personId>            (optionnel — rattachement à une personne)
//   --scope   <TYPE[:id]>            (optionnel ; ex. ESTABLISHMENT:est-123, LEGAL_ENTITY:co-1, TENANT)
//   --must-change                    (le compte devra changer son mot de passe à la 1re connexion)
import { getRepository } from "../src/store-selector.js";
import { AuthService } from "../src/auth-service.js";
import { STANDARD_ROLES } from "../src/auth.js";
import { Scope, ScopeType } from "../src/types.js";

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) { out[key] = next; i++; } else { out[key] = true; }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = String(args.email ?? "").trim().toLowerCase();
  const tenantId = String(args.tenant ?? "").trim();
  const roleNames = String(args.role ?? "").split(",").map((r) => r.trim()).filter(Boolean);
  const personId = args.person ? String(args.person) : undefined;
  const mustChangePassword = !!args["must-change"];
  const password = process.env.USER_PASSWORD ?? "";

  const errors: string[] = [];
  if (!email) errors.push("--email requis");
  if (!tenantId) errors.push("--tenant requis");
  if (!roleNames.length) errors.push("--role requis (ex. TenantAdmin)");
  if (!password) errors.push("USER_PASSWORD (variable d'environnement) requis");
  if (password && password.length < 10) errors.push("USER_PASSWORD trop court (≥ 10 caractères)");
  const unknown = roleNames.filter((r) => !STANDARD_ROLES.includes(r));
  if (unknown.length) errors.push(`rôle(s) inconnu(s) : ${unknown.join(", ")} — attendus : ${STANDARD_ROLES.join(", ")}`);
  if (errors.length) { console.error("✗ " + errors.join("\n✗ ")); process.exit(1); }

  // Périmètre explicite optionnel (sinon défaut par rôle appliqué au login).
  let scopes: Scope[] | undefined;
  if (typeof args.scope === "string") {
    const [type, id] = args.scope.split(":");
    scopes = [{ type: type as ScopeType, id: id || undefined }];
  }

  const repo = await getRepository();
  const auth = new AuthService(repo);
  const acc = await auth.createAccount({ email, tenantId, roleNames, password, personId, scopes, mustChangePassword });
  // On n'affiche JAMAIS le mot de passe.
  console.log(`✓ Compte créé : ${acc.email} (id ${acc.id}) — tenant ${acc.tenantId} — rôles ${acc.roleNames.join(", ")}` +
    (scopes ? ` — périmètre ${scopes.map((s) => s.type + (s.id ? ":" + s.id : "")).join(",")}` : "") +
    (mustChangePassword ? " — changement de mot de passe requis à la 1re connexion" : ""));
  process.exit(0);
}

main().catch((e) => { console.error("✗ " + (e?.message ?? e)); process.exit(1); });
