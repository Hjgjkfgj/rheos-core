#!/usr/bin/env node
// =============================================================================
// Rhéos — Linter de vocabulaire (ADR-002 + Tome 01 « Glossaire & termes interdits »)
// -----------------------------------------------------------------------------
// Deux contrôles, sans dépendance externe :
//   (A) UI / doc (français, orienté utilisateur) : échoue si un TERME INTERDIT du
//       glossaire apparaît (« salarié », « employé », « dossier salarié »…).
//   (B) Code : échoue si un IDENTIFIANT contient un mot FRANÇAIS métier
//       (ADR-002 : code/BDD/API en anglais). Les commentaires et les chaînes
//       (messages d'erreur FR autorisés) sont ignorés — seuls les identifiants
//       sont analysés.
//
// Usage :   node scripts/vocab-lint.mjs
//           node scripts/vocab-lint.mjs --json
// Sortie :  code 0 si conforme, 1 si au moins une violation « error ».
// Échappatoire ponctuelle : une ligne contenant «  vocab-ignore  » est ignorée.
//
// Le dictionnaire ci-dessous EST la configuration du linter (donnée, pas règle
// codée en dur dans la logique) — il évolue avec le glossaire du Tome 01.
// =============================================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// --- (A) Termes interdits UI/doc → terme officiel (Tome 01 §4) ----------------
// N'y figurent QUE les termes à haute confiance (faux positifs écartés :
// « personnel » → « registre du personnel » est un terme légal ; « site » →
// « Site Marseille » est un nom propre d'établissement ; « employeur » est
// contextuel). Ces cas restent en revue manuelle (voir docs/convergence-report.md).
// L'accent est exigé sur salarié/employé pour ne pas capturer l'anglais
// « salaries » / « employee » (homographes ASCII).
// Délimiteurs qui reconnaissent les lettres accentuées (le \b ASCII échoue
// autour d'un « é »). Les accents sont exigés sur salarié/employé pour ne pas
// capturer l'anglais « salaries » / « employee ».
const L = "A-Za-zÀ-ÿ";
const B = (body) => new RegExp(`(?<![${L}])(?:${body})(?![${L}])`, "gi");
const FORBIDDEN_UI = [
  { re: B("dossier\\s+salarié(?:e|s|es)?"), official: "dossier collaborateur" },
  { re: B("fiche\\s+salarié(?:e|s|es)?"), official: "profil collaborateur" },
  { re: B("salarié(?:e|s|es)?"), official: "collaborateur(s)" },
  { re: B("employé(?:e|s|es)?"), official: "collaborateur(s)" },
  { re: B("planning\\s+hebdo"), official: "planning" },
];

// --- (B) Mots français métier interdits dans les IDENTIFIANTS de code ---------
// ASCII-repliés (les identifiants sont sans accent). Les homographes EN/FR
// (absence, convention, position, service, mention, format…) sont volontairement
// exclus pour éviter les faux positifs.
const FORBIDDEN_CODE_TOKENS = new Set([
  "salarie", "salaries", "employe", "employes", "entreprise", "entreprises",
  "etablissement", "etablissements", "collaborateur", "collaborateurs",
  "contrat", "contrats", "avenant", "avenants", "conge", "conges",
  "embauche", "affectation", "remuneration", "effectif", "effectifs",
  "dossier", "fiche", "poste", "postes", "metier", "prenom", "societe",
  "coffre", "signataire",
]);

// --- Cibles par défaut --------------------------------------------------------
const UI_ROOTS = ["web", "README.md"];   // surfaces produit (UI + doc racine)
const CODE_ROOTS = ["src"];              // identifiants de code
// Exclusions (le rapport interne cite volontairement des termes interdits).
const EXCLUDE = ["node_modules", ".git", "dist", "docs", "test"];

// -----------------------------------------------------------------------------
function walk(target) {
  const abs = join(ROOT, target);
  let st;
  try { st = statSync(abs); } catch { return []; }
  if (st.isFile()) return [abs];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (EXCLUDE.includes(name)) continue;
    out.push(...walk(join(target, name)));
  }
  return out;
}

function collect(roots, exts) {
  const files = new Set();
  for (const r of roots) for (const f of walk(r)) {
    if (!exts || exts.includes(extname(f))) files.add(f);
  }
  return [...files];
}

// Retire commentaires et littéraux de chaîne pour ne garder que le code réel.
function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")          // /* ... */
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")        // // ...  (évite http://)
    .replace(/`(?:\\.|[^`\\])*`/g, " ")            // template strings
    .replace(/"(?:\\.|[^"\\])*"/g, " ")            // "..."
    .replace(/'(?:\\.|[^'\\])*'/g, " ");           // '...'
}

// Découpe un identifiant camelCase/snake en sous-tokens ASCII minuscules.
function subTokens(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase());
}

const violations = [];
function add(file, line, level, message) {
  violations.push({ file: relative(ROOT, file), line, level, message });
}

// (A) UI / doc
for (const file of collect(UI_ROOTS, [".html", ".md", ".txt"])) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((raw, i) => {
    if (raw.includes("vocab-ignore")) return;
    for (const { re, official } of FORBIDDEN_UI) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(raw)) !== null) {
        add(file, i + 1, "error", `terme interdit « ${m[0]} » → utiliser « ${official} » (Tome 01)`);
      }
    }
  });
}

// (B) Code — identifiants français
for (const file of collect(CODE_ROOTS, [".ts", ".tsx", ".js", ".mjs"])) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((raw, i) => {
    if (raw.includes("vocab-ignore")) return;
    const code = stripCommentsAndStrings(raw);
    for (const id of code.match(/[A-Za-z_$][A-Za-z0-9_$]{2,}/g) ?? []) {
      for (const tok of subTokens(id)) {
        if (FORBIDDEN_CODE_TOKENS.has(tok)) {
          add(file, i + 1, "error", `identifiant français « ${id} » (token « ${tok} ») — code en anglais (ADR-002)`);
          break;
        }
      }
    }
  });
}

// --- Rapport ------------------------------------------------------------------
const json = process.argv.includes("--json");
const errors = violations.filter((v) => v.level === "error");
if (json) {
  console.log(JSON.stringify({ ok: errors.length === 0, count: errors.length, violations }, null, 2));
} else if (violations.length === 0) {
  console.log("✓ vocab-lint : aucune violation de vocabulaire (Tome 01 / ADR-002).");
} else {
  for (const v of violations) {
    console.log(`${v.level === "error" ? "✗" : "•"} ${v.file}:${v.line}  ${v.message}`);
  }
  console.log(`\n${errors.length} violation(s) « error ».`);
}
process.exit(errors.length > 0 ? 1 : 0);
