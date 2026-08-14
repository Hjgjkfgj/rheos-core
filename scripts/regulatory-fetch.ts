// Rhéos — Ingestion du référentiel réglementaire depuis SocialGouv/kali-data (R1, ADR-020).
//   npm run regulatory:fetch <IDCC> [IDCC…]
// Télécharge le texte consolidé public d'une convention (par IDCC), le stocke en
// RegulatoryText VERSIONNÉ (idempotent : hash identique → aucun doublon ; changement →
// nouvelle version + événement RegulatoryTextUpdated). ÉCRITURE = rôle admin (l'app est
// en lecture seule sur le référentiel) : exécuter avec DATABASE_URL = URL admin en prod.
import { getRepository } from "../src/store-selector.js";
import { EventBus } from "../src/events.js";
import { RegulatoryService } from "../src/services-regulatory.js";

const INDEX = "https://raw.githubusercontent.com/SocialGouv/kali-data/master/data/index.json";
const DATA = (id: string) => `https://raw.githubusercontent.com/SocialGouv/kali-data/master/data/${id}.json`;

// Extrait un « outline » lisible (titres des sections/articles + état) du texte consolidé.
function outline(tree: any): string {
  const lines: string[] = [];
  const walk = (n: any, depth: number) => {
    const t = n?.data?.title || n?.data?.num;
    if (t) lines.push(`${"  ".repeat(depth)}${t}${n?.data?.etat ? " [" + n.data.etat + "]" : ""}`);
    if (depth < 3) for (const c of n?.children ?? []) walk(c, depth + 1);
  };
  walk(tree, 0);
  let out = lines.join("\n");
  if (out.length > 60000) out = out.slice(0, 60000) + "\n… (tronqué)";
  return out;
}

const idccs = process.argv.slice(2);
if (!idccs.length) { console.error("Usage : tsx scripts/regulatory-fetch.ts <IDCC> [IDCC…]"); process.exit(2); }

const repo = await getRepository();
const bus = new EventBus();
bus.onPersist = (e) => { void repo.appendDomainEvent(e); };
const svc = new RegulatoryService(repo, bus);

const index = (await (await fetch(INDEX)).json()) as any[];
let failures = 0;
for (const idcc of idccs) {
  const entry = index.find((x) => String(x.num) === idcc);
  if (!entry) { console.error(`✗ IDCC ${idcc} introuvable dans l'index KALI`); failures++; continue; }
  const raw = await (await fetch(DATA(entry.id))).text();
  const tree = JSON.parse(raw);
  const res = await svc.ingestText({
    idcc, kaliId: entry.id, title: entry.title || entry.shortTitle,
    effectiveDate: entry.date_publi, content: outline(tree), hashInput: raw,
    sourceUrl: entry.url, sourceName: "KALI",
  });
  console.log(`${res.changed ? "✓ nouvelle version" : "= inchangé"} — IDCC ${idcc} (${entry.shortTitle}) v${res.version}, hash ${res.hash.slice(0, 12)}…`);
}
process.exit(failures ? 1 : 0);
