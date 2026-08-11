// Rhéos — parseur/sérialiseur CSV maison (Lot 16, aucune dépendance).
// Gère : délimiteur , ; ou tabulation (détecté), guillemets doubles avec
// échappement "", BOM UTF-8, fins de ligne CRLF/LF, champs multi-lignes.
// Détection d'encodage UTF-8 vs Latin-1 (windows-1252) pour préserver les accents.

/// Décode des octets bruts en texte, en détectant l'encodage (import de fichiers
/// exportés depuis Excel/tableurs FR, souvent en Latin-1/windows-1252).
export function decodeBytes(buf: Buffer): { text: string; encoding: "utf-8" | "latin1" } {
  // BOM UTF-8 explicite.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8" };
  }
  // Un UTF-8 valide se décode sans séquence invalide ; sinon on retombe sur Latin-1.
  if (isValidUtf8(buf)) return { text: buf.toString("utf8"), encoding: "utf-8" };
  return { text: buf.toString("latin1"), encoding: "latin1" };
}

/// Validation stricte des séquences UTF-8 (RFC 3629).
function isValidUtf8(buf: Buffer): boolean {
  let i = 0;
  while (i < buf.length) {
    const b = buf[i];
    if (b <= 0x7f) { i++; continue; }
    let n: number;
    if (b >= 0xc2 && b <= 0xdf) n = 1;
    else if (b >= 0xe0 && b <= 0xef) n = 2;
    else if (b >= 0xf0 && b <= 0xf4) n = 3;
    else return false;
    if (i + n >= buf.length) return false;
    for (let k = 1; k <= n; k++) if ((buf[i + k] & 0xc0) !== 0x80) return false;
    i += n + 1;
  }
  return true;
}

const DELIMS = [",", ";", "\t"];

/// Délimiteur majoritaire sur la première ligne (hors guillemets). Défaut : virgule.
export function detectDelimiter(headerLine: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQ = false;
  for (const ch of headerLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && ch in counts) counts[ch]++;
  }
  let best = ",", bestN = 0;
  for (const d of DELIMS) if (counts[d] > bestN) { best = d; bestN = counts[d]; }
  return best;
}

export interface ParsedCsv { headers: string[]; rows: string[][]; delimiter: string }

/// Parse un texte CSV en en-têtes + lignes. Robuste aux guillemets, échappements
/// "", CRLF/LF et champs contenant le délimiteur ou des retours à la ligne.
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM sous forme de caractère
  const nl = text.indexOf("\n");
  const firstLine = nl >= 0 ? text.slice(0, nl) : text;
  const delim = delimiter ?? detectDelimiter(firstLine);
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (ch !== "\r") field += ch; // \r ignoré (CRLF)
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ""));
  const headers = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { headers, rows: nonEmpty, delimiter: delim };
}

/// Sérialise des lignes en CSV (guillemets uniquement si nécessaire).
export function toCsv(rows: (string | number | null | undefined)[][], delimiter = ","): string {
  const esc = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    return s.includes(delimiter) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(delimiter)).join("\r\n");
}
