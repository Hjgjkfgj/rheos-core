// Rhéos — générateur PDF minimal (Lot 17, aucune dépendance).
// Produit un PDF 1.4 valide, multi-pages, texte Helvetica (WinAnsiEncoding pour les
// accents FR). Suffisant pour un export lisible « droit d'accès » (RGPD art. 15).
// Pas de mise en forme riche : titres en gras, lignes de texte, pagination auto.

export interface PdfSection { heading: string; lines: string[] }

/// Échappe le texte pour un littéral PDF et le restreint à WinAnsi (Latin-1).
function esc(s: string): string {
  return s
    .replace(/€/g, " EUR")
    .replace(/[^\x00-\xFF]/g, "?")       // hors Latin-1 → '?'
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")
    .replace(/[\r\n\t]/g, " ");
}

/// Construit un PDF à partir d'un titre et de sections (titre + lignes).
export function buildPdf(title: string, sections: PdfSection[]): Buffer {
  type Line = { text: string; bold?: boolean };
  const lines: Line[] = [{ text: title, bold: true }, { text: "" }];
  for (const sec of sections) {
    lines.push({ text: sec.heading, bold: true });
    for (const l of sec.lines) lines.push({ text: l });
    lines.push({ text: "" });
  }
  const perPage = 50;
  const pages: Line[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  const N = pages.length;
  const PAGE0 = 5, CONTENT0 = 5 + N, total = 4 + 2 * N;
  const offsets = new Array(total + 1).fill(0);
  const chunks: Buffer[] = [];
  let pos = 0;
  const push = (s: string) => { const b = Buffer.from(s, "latin1"); chunks.push(b); pos += b.length; };
  const obj = (n: number, body: string) => { offsets[n] = pos; push(`${n} 0 obj\n${body}\nendobj\n`); };

  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [ ${pages.map((_, i) => `${PAGE0 + i} 0 R`).join(" ")} ] /Count ${N} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  for (let i = 0; i < N; i++) {
    obj(PAGE0 + i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${CONTENT0 + i} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`);
  }
  for (let i = 0; i < N; i++) {
    let s = "BT 14 TL 50 792 Td\n";
    for (const line of pages[i]) s += `${line.bold ? "/F2 12" : "/F1 10.5"} Tf (${esc(line.text)}) Tj T*\n`;
    s += "ET";
    const len = Buffer.byteLength(s, "latin1");
    obj(CONTENT0 + i, `<< /Length ${len} >>\nstream\n${s}\nendstream`);
  }
  const xrefAt = pos;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`);
  return Buffer.concat(chunks);
}
