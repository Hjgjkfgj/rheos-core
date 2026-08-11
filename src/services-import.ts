// Rhéos — Import massif de collaborateurs + export miroir (Lot 16, Tome 08 §1.38/§6.41).
// Flux : upload CSV → mapping assisté des colonnes → validation (formats, doublons
// nom+prénom+naissance, dates incohérentes) → rapport d'erreurs → préversion → commit.
// Les lignes conformes passent (cascade d'embauche standard Person→Employment→Contrat
// DRAFT via Services.hire) ; les anomalies sont isolées avec motif. Chaque import est
// un événement AUDITÉ et IDEMPOTENT (re-jouer le même fichier ne crée pas de doublons :
// dédoublonnage sur nom+prénom+date de naissance, comme findPersonDuplicates).
import { createHash } from "crypto";
import { uid } from "./store.js";
import { EventBus } from "./events.js";
import { Repository } from "./repository.js";
import { Services } from "./services.js";
import { assertCan } from "./auth.js";
import { parseCsv, toCsv, decodeBytes } from "./domain/csv.js";
import { Ctx, AppError, ContractType, Person, Establishment } from "./types.js";

// --- Catalogue des colonnes importables (clé technique + libellé FR + synonymes) ----
export interface ImportField { key: string; label: string; required?: boolean; synonyms: string[] }
export const IMPORT_FIELDS: ImportField[] = [
  { key: "lastName", label: "Nom", required: true, synonyms: ["nom", "nom de famille", "last name", "lastname", "surname"] },
  { key: "firstName", label: "Prénom", required: true, synonyms: ["prenom", "first name", "firstname", "given name"] },
  { key: "birthDate", label: "Date de naissance", synonyms: ["date de naissance", "naissance", "birthdate", "birth date", "dob", "ne le", "nee le"] },
  { key: "startDate", label: "Date d'entrée", required: true, synonyms: ["date d'entree", "date entree", "entree", "embauche", "date embauche", "start date", "startdate", "hire date", "date de debut", "debut"] },
  { key: "contractType", label: "Type de contrat", required: true, synonyms: ["type de contrat", "contrat", "contract", "contract type", "type"] },
  { key: "grossMonthly", label: "Rémunération brute mensuelle (€)", synonyms: ["remuneration", "salaire", "brut", "brut mensuel", "salaire brut", "gross", "gross monthly", "remuneration brute"] },
  { key: "workingTime", label: "Temps de travail (h/sem.)", synonyms: ["temps de travail", "heures", "heures hebdo", "working time", "hours", "duree hebdomadaire"] },
  { key: "establishmentSiret", label: "SIRET établissement", synonyms: ["siret", "siret etablissement", "etablissement", "establishment", "code etablissement"] },
  { key: "personalEmail", label: "Email personnel", synonyms: ["email", "e-mail", "courriel", "mail", "email personnel", "adresse email"] },
];

// Type de contrat : synonymes FR/EN + valeurs d'énumération, tolérant.
const CONTRACT_MAP: Record<string, ContractType> = {
  cdi: "CDI", cdd: "CDD",
  apprentissage: "APPRENTICESHIP", apprenti: "APPRENTICESHIP", apprenticeship: "APPRENTICESHIP",
  professionnalisation: "PROFESSIONALIZATION", pro: "PROFESSIONALIZATION", professionalization: "PROFESSIONALIZATION",
  stage: "INTERNSHIP", stagiaire: "INTERNSHIP", internship: "INTERNSHIP",
  interim: "TEMPORARY", temporaire: "TEMPORARY", temporary: "TEMPORARY",
  saisonnier: "SEASONAL", seasonal: "SEASONAL",
};

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const dupKey = (last: string, first: string, birth?: string) => `${last.toLowerCase()}|${first.toLowerCase()}|${birth ?? ""}`;

function validYmd(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
/// Normalise une date (ISO ou FR JJ/MM/AAAA, séparateurs / . -) → ISO, ou null si invalide.
function normDate(s: string): string | null {
  s = s.trim(); if (!s) return null;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) {
    const y = +m[1], mo = +m[2], d = +m[3];
    return validYmd(y, mo, d) ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  }
  if ((m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s))) {
    const d = +m[1], mo = +m[2], y = +m[3];
    return validYmd(y, mo, d) ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null;
  }
  return null;
}
/// Nombre tolérant au format FR : « 1 900,50 » / « 1.900,50 » / « 1900.5 » → 1900.5.
function normNumber(s: string): number | null {
  s = s.replace(/[\s ]/g, "").trim(); if (!s) return null;
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function normContract(s: string): ContractType | null { return CONTRACT_MAP[strip(s).replace(/[^a-z]/g, "")] ?? null; }
const addYears = (iso: string, n: number) => `${+iso.slice(0, 4) + n}${iso.slice(4)}`;
function yearsBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  let age = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) age--;
  return age;
}

export type RowStatus = "toImport" | "review" | "rejected" | "skipped";
export interface RowResult { line: number; status: RowStatus; record: Record<string, any>; messages: string[] }
export interface ImportReport {
  summary: { total: number; imported: number; review: number; rejected: number; skipped: number };
  rows: RowResult[];
  meta: { encoding?: string; delimiter?: string; format: string; filename?: string; fileHash: string; headers: string[] };
  mapping: Record<string, number>;
}

export class ImportService {
  constructor(private repo: Repository, private bus: EventBus, private services: Services) {}

  // ---- Parsing du fichier (CSV natif ; XLSX → message d'aide) ---------------
  private parse(input: { fileBase64?: string; content?: string; filename?: string }): { headers: string[]; rows: string[][]; encoding?: string; delimiter: string; format: string; raw: string } {
    let text: string, encoding: string | undefined;
    const name = (input.filename ?? "").toLowerCase();
    if (input.fileBase64) {
      const buf = Buffer.from(input.fileBase64, "base64");
      // Signature ZIP (PK) ou extension .xlsx → tableur binaire non pris en charge.
      if (name.endsWith(".xlsx") || (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b)) {
        throw new AppError(415, "unsupported_format", "Format .xlsx non pris en charge. Dans Excel : Fichier → Enregistrer sous → « CSV UTF-8 (délimité par des virgules) », puis réimportez le .csv.");
      }
      const d = decodeBytes(buf); text = d.text; encoding = d.encoding;
    } else if (input.content != null) {
      text = input.content; encoding = "utf-8";
    } else {
      throw new AppError(400, "bad_request", "fileBase64 ou content requis");
    }
    const parsed = parseCsv(text);
    if (!parsed.headers.length) throw new AppError(400, "empty_file", "Fichier vide ou sans en-têtes.");
    return { headers: parsed.headers, rows: parsed.rows, encoding, delimiter: parsed.delimiter, format: "csv", raw: text };
  }

  /// Mapping assisté : associe chaque champ à l'index de colonne le plus probable.
  suggestMapping(headers: string[]): Record<string, number> {
    const norm = headers.map(strip);
    const mapping: Record<string, number> = {};
    const used = new Set<number>();
    for (const f of IMPORT_FIELDS) {
      let idx = -1;
      // 1) correspondance exacte avec un synonyme ; 2) inclusion.
      for (const syn of [f.key.toLowerCase(), ...f.synonyms.map(strip)]) {
        idx = norm.findIndex((h, i) => !used.has(i) && h === syn);
        if (idx >= 0) break;
      }
      if (idx < 0) {
        for (const syn of f.synonyms.map(strip)) {
          idx = norm.findIndex((h, i) => !used.has(i) && (h.includes(syn) || syn.includes(h)) && h.length > 1);
          if (idx >= 0) break;
        }
      }
      if (idx >= 0) { mapping[f.key] = idx; used.add(idx); }
    }
    return mapping;
  }

  private async existingIndex(tenantId: string): Promise<Map<string, Set<string>>> {
    const idx = new Map<string, Set<string>>();
    for (const p of await this.repo.listPersonsByTenant(tenantId)) {
      const np = `${p.lastName.toLowerCase()}|${p.firstName.toLowerCase()}`;
      if (!idx.has(np)) idx.set(np, new Set());
      idx.get(np)!.add(p.birthDate ?? "");
    }
    return idx;
  }
  // Existant si même nom+prénom ET (ligne sans naissance, OU naissance identique, OU existant sans naissance).
  private isExisting(idx: Map<string, Set<string>>, rec: any): boolean {
    const dobs = idx.get(`${rec.lastName.toLowerCase()}|${rec.firstName.toLowerCase()}`);
    if (!dobs) return false;
    if (!rec.birthDate) return true;
    return dobs.has(rec.birthDate) || dobs.has("");
  }

  /// Classification déterministe d'un lot (partagée par la préversion et le commit).
  private classify(headers: string[], rows: string[][], mapping: Record<string, number>, existing: Map<string, Set<string>>, siretIndex: Map<string, Establishment>): RowResult[] {
    const seen = new Set<string>();
    const todayISO = new Date().toISOString().slice(0, 10);
    const out: RowResult[] = [];
    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i];
      const get = (k: string) => (mapping[k] != null ? raw[mapping[k]] ?? "" : "").trim();
      const rec: any = {}; const msg: string[] = []; let hard = false;

      rec.lastName = get("lastName"); rec.firstName = get("firstName");
      if (!rec.lastName) { msg.push("Nom manquant"); hard = true; }
      if (!rec.firstName) { msg.push("Prénom manquant"); hard = true; }

      const sd = get("startDate");
      if (!sd) { msg.push("Date d'entrée manquante"); hard = true; }
      else { rec.startDate = normDate(sd); if (!rec.startDate) { msg.push(`Date d'entrée invalide : « ${sd} »`); hard = true; } }

      const ct = get("contractType");
      if (!ct) { msg.push("Type de contrat manquant"); hard = true; }
      else { rec.contractType = normContract(ct); if (!rec.contractType) { msg.push(`Type de contrat inconnu : « ${ct} »`); hard = true; } }

      const bd = get("birthDate");
      if (bd) { rec.birthDate = normDate(bd); if (!rec.birthDate) { msg.push(`Date de naissance invalide : « ${bd} »`); hard = true; } }
      const gm = get("grossMonthly");
      if (gm) { rec.grossMonthly = normNumber(gm); if (rec.grossMonthly == null) { msg.push(`Rémunération non numérique : « ${gm} »`); hard = true; } }
      const wt = get("workingTime");
      if (wt) { rec.workingTime = normNumber(wt); if (rec.workingTime == null) { msg.push(`Temps de travail non numérique : « ${wt} »`); hard = true; } }
      const siret = get("establishmentSiret").replace(/[\s ]/g, "");
      if (siret) rec.establishmentSiret = siret;
      const email = get("personalEmail"); if (email) rec.personalEmail = email;

      if (hard) { out.push({ line: i + 2, status: "rejected", record: rec, messages: msg }); continue; }

      const soft: string[] = [];
      if (rec.birthDate) {
        if (rec.birthDate > todayISO) soft.push("Date de naissance dans le futur");
        else { const age = yearsBetween(rec.birthDate, rec.startDate); if (age < 16) soft.push(`Âge à l'embauche inférieur à 16 ans (${age})`); else if (age > 90) soft.push(`Âge à l'embauche supérieur à 90 ans (${age})`); }
      }
      if (rec.startDate < "2000-01-01") soft.push("Date d'entrée antérieure à 2000");
      if (rec.startDate > addYears(todayISO, 2)) soft.push("Date d'entrée à plus de 2 ans dans le futur");
      if (siret && !siretIndex.has(siret)) soft.push(`SIRET d'établissement inconnu dans l'entreprise : ${siret}`);

      const key = dupKey(rec.lastName, rec.firstName, rec.birthDate);
      if (this.isExisting(existing, rec)) { out.push({ line: i + 2, status: "skipped", record: rec, messages: ["Déjà présent dans le tenant — ignoré (import idempotent)"] }); continue; }
      if (seen.has(key)) { out.push({ line: i + 2, status: "review", record: rec, messages: ["Doublon dans le fichier (nom + prénom + date de naissance)"] }); continue; }
      seen.add(key);
      if (soft.length) { out.push({ line: i + 2, status: "review", record: rec, messages: soft }); continue; }
      out.push({ line: i + 2, status: "toImport", record: rec, messages: [] });
    }
    return out;
  }

  private summarize(rows: RowResult[]) {
    const c = { total: rows.length, imported: 0, review: 0, rejected: 0, skipped: 0 };
    for (const r of rows) { if (r.status === "review") c.review++; else if (r.status === "rejected") c.rejected++; else if (r.status === "skipped") c.skipped++; }
    return c;
  }

  /// Préversion (dry-run) : classe chaque ligne, AUCUNE écriture.
  async preview(ctx: Ctx, companyId: string, input: { fileBase64?: string; content?: string; filename?: string; mapping?: Record<string, number> }): Promise<ImportReport> {
    assertCan(ctx, "employment.write");
    await this.services.getLegalEntity(ctx, companyId);
    const parsed = this.parse(input);
    const mapping = input.mapping ?? this.suggestMapping(parsed.headers);
    const missing = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] == null).map((f) => f.label);
    if (missing.length) throw new AppError(422, "missing_columns", `Colonnes obligatoires non mappées : ${missing.join(", ")}.`, { headers: parsed.headers, suggestion: mapping });
    const ests = await this.repo.listEstablishmentsByCompany(ctx.tenantId, companyId);
    const siretIndex = new Map(ests.map((e) => [e.siret, e]));
    const rows = this.classify(parsed.headers, parsed.rows, mapping, await this.existingIndex(ctx.tenantId), siretIndex);
    const fileHash = createHash("sha256").update(parsed.raw).digest("hex");
    return { summary: this.summarize(rows), rows, meta: { encoding: parsed.encoding, delimiter: parsed.delimiter, format: parsed.format, filename: input.filename, fileHash, headers: parsed.headers }, mapping };
  }

  /// Commit : importe les lignes conformes via la cascade d'embauche standard.
  /// Idempotent (les lignes déjà présentes sont ignorées) et audité (événement + AuditLog).
  async commit(ctx: Ctx, companyId: string, input: { fileBase64?: string; content?: string; filename?: string; mapping?: Record<string, number>; defaultEstablishmentId?: string }): Promise<ImportReport> {
    const report = await this.preview(ctx, companyId, input);
    const ests = await this.repo.listEstablishmentsByCompany(ctx.tenantId, companyId);
    const siretIndex = new Map(ests.map((e) => [e.siret, e]));
    const fallbackEst = input.defaultEstablishmentId ?? ests[0]?.id;
    let imported = 0;
    for (const r of report.rows) {
      if (r.status !== "toImport") continue;
      const estId = r.record.establishmentSiret ? siretIndex.get(r.record.establishmentSiret)?.id ?? fallbackEst : fallbackEst;
      await this.services.hire(ctx, {
        person: { lastName: r.record.lastName, firstName: r.record.firstName, birthDate: r.record.birthDate },
        legalEntityId: companyId, administrativeEstablishmentId: estId,
        startDate: r.record.startDate, contractType: r.record.contractType,
        grossMonthly: r.record.grossMonthly, workingTime: r.record.workingTime,
      });
      r.status = "imported" as any; imported++;
    }
    report.summary.imported = imported;
    // Événement audité + journal métier (traçabilité de l'import).
    const c = report.summary;
    this.bus.publish(ctx.tenantId, "LegalEntity", companyId, "CollaboratorsImported", { fileHash: report.meta.fileHash, filename: input.filename ?? null, imported: c.imported, review: c.review, rejected: c.rejected, skipped: c.skipped, total: c.total }, ctx.userId);
    await this.repo.appendAudit({ id: uid(), tenantId: ctx.tenantId, userId: ctx.userId, action: "collaborators.import", entityType: "LegalEntity", entityId: companyId, after: c, reason: report.meta.fileHash, at: new Date().toISOString() });
    return report;
  }

  // ---- Export miroir (réversibilité + portabilité RGPD) --------------------
  /// Exporte les collaborateurs du tenant (ou d'une entreprise) en CSV ou JSON.
  async exportCollaborators(ctx: Ctx, opts: { companyId?: string; format?: string }): Promise<{ contentType: string; filename: string; body: string }> {
    assertCan(ctx, "registry.export");
    const emps = opts.companyId
      ? await (async () => { await this.services.getLegalEntity(ctx, opts.companyId!); return this.repo.listEmploymentsByCompany(ctx.tenantId, opts.companyId!); })()
      : await this.repo.listEmploymentsByTenant(ctx.tenantId);
    const persons = new Map((await this.repo.listPersonsByTenant(ctx.tenantId)).map((p) => [p.id, p]));
    const ests = new Map<string, Establishment>();
    for (const e of emps) if (e.administrativeEstablishmentId && !ests.has(e.administrativeEstablishmentId)) {
      const est = await this.repo.getEstablishment(ctx.tenantId, e.administrativeEstablishmentId);
      if (est) ests.set(est.id, est);
    }
    const sorted = [...emps].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const records = [];
    for (const e of sorted) {
      const p = persons.get(e.personId) as Person | undefined;
      const contracts = await this.repo.listContractsByEmployment(ctx.tenantId, e.id);
      const contract = contracts.sort((a, b) => a.startDate.localeCompare(b.startDate)).pop();
      const est = e.administrativeEstablishmentId ? ests.get(e.administrativeEstablishmentId) : undefined;
      records.push({
        lastName: p?.lastName ?? "", firstName: p?.firstName ?? "", birthDate: p?.birthDate ?? "",
        establishmentSiret: est?.siret ?? "", establishmentName: est?.name ?? "",
        startDate: e.startDate, endDate: e.endDate ?? "", status: e.status,
        contractType: contract?.type ?? "", grossMonthly: contract?.grossMonthly ?? "", classification: contract?.classification ?? "",
      });
    }
    if ((opts.format ?? "csv").toLowerCase() === "json") {
      return { contentType: "application/json; charset=utf-8", filename: "collaborateurs.json", body: JSON.stringify(records, null, 2) };
    }
    const cols = ["lastName", "firstName", "birthDate", "establishmentSiret", "establishmentName", "startDate", "endDate", "status", "contractType", "grossMonthly", "classification"];
    const header = ["Nom", "Prénom", "Date de naissance", "SIRET établissement", "Établissement", "Date d'entrée", "Date de sortie", "Statut", "Type de contrat", "Rémunération brute mensuelle (€)", "Classification"];
    const body = "﻿" + toCsv([header, ...records.map((r) => cols.map((c) => (r as any)[c]))]); // BOM → accents corrects dans Excel
    return { contentType: "text/csv; charset=utf-8", filename: "collaborateurs.csv", body };
  }
}
