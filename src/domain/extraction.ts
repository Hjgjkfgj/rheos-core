// Extraction documentaire : à partir du texte d'un document (OCR / PDF / saisie),
// pré-remplit des champs du dossier. L'extraction NE VAUT PAS validation
// juridique (Tome 08 §1.17) : les champs restent à confirmer par un humain.
//
// Correctif clé : l'IBAN et le NIR (numéros longs) sont retirés du texte AVANT
// la détection du téléphone, pour éviter qu'une suite de chiffres bancaires ou
// de sécurité sociale ne soit prise pour un numéro de téléphone.

export interface ExtractedFields {
  email?: string;
  phone?: string;
  iban?: string;
  nir?: string;
  postalCode?: string;
  birthDate?: string; // ISO YYYY-MM-DD
}

const RE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const RE_IBAN_SPACED = /\bFR\d{2}(?:[ ]?[0-9A-Z]){23}\b/i; // IBAN FR (27 car.), espaces tolérés
const RE_NIR = /\b[12](?:[ .]?\d){14}\b/;                   // NIR : 15 chiffres
const RE_PHONE = /\b0[1-9](?:[ .]?\d{2}){4}\b/;             // tél. FR
const RE_POSTAL = /\b\d{5}\b/;
const RE_DOB = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;

// --- Analyse documentaire (R1) : type de pièce + confiance + statut ----------
// L'extraction NE VAUT JAMAIS validation (ADR-010) : isValidation = false.
export type DetectedDocType = "CONTRACT" | "PAYSLIP" | "ID_DOCUMENT" | "BANK_DETAILS" | "OTHER";
export type ExtractionStatus = "EXTRACTED" | "REQUIRES_REVIEW";

export interface ExtractionResult {
  documentType: DetectedDocType;
  fields: ExtractedFields;
  confidence: number;      // 0..1
  status: ExtractionStatus; // < seuil → REQUIRES_REVIEW
  isValidation: false;      // garde-fou : l'extraction ne valide jamais
}

const CONFIDENCE_THRESHOLD = 0.6;

function detectDocType(text: string, f: ExtractedFields): { type: DetectedDocType; typeConfidence: number } {
  const t = text.toLowerCase();
  const has = (...kw: string[]) => kw.filter((k) => t.includes(k)).length;
  const scores: Record<DetectedDocType, number> = {
    PAYSLIP: has("bulletin", "net à payer", "salaire brut", "cotisation", "net imposable"),
    CONTRACT: has("contrat", "cdi", "cdd", "période d'essai", "rémunération", "employeur"),
    ID_DOCUMENT: has("carte", "identité", "passeport", "titre de séjour") + (f.nir ? 1 : 0),
    BANK_DETAILS: has("iban", "rib", "bic", "relevé") + (f.iban ? 1 : 0),
    OTHER: 0,
  };
  let type: DetectedDocType = "OTHER"; let best = 0;
  for (const k of Object.keys(scores) as DetectedDocType[]) if (scores[k] > best) { best = scores[k]; type = k; }
  return { type, typeConfidence: Math.min(1, best / 2) }; // 2 signaux ⇒ pleine confiance de type
}

/// Analyse complète : champs + type + score + statut. Déterministe.
export function analyzeDocument(text: string): ExtractionResult {
  const fields = extractFields(text);
  const { type, typeConfidence } = detectDocType(text, fields);
  // Confiance = mélange (type reconnu, densité de champs exploitables).
  const fieldSignals = [fields.email, fields.phone, fields.iban, fields.nir, fields.postalCode, fields.birthDate].filter(Boolean).length;
  const fieldConfidence = Math.min(1, fieldSignals / 3);
  const confidence = Math.round((0.5 * typeConfidence + 0.5 * fieldConfidence) * 100) / 100;
  const status: ExtractionStatus = confidence < CONFIDENCE_THRESHOLD ? "REQUIRES_REVIEW" : "EXTRACTED";
  return { documentType: type, fields, confidence, status, isValidation: false };
}

export function extractFields(text: string): ExtractedFields {
  const res: ExtractedFields = {};

  const email = text.match(RE_EMAIL);
  if (email) res.email = email[0];

  // IBAN (sur texte compacté sans espaces pour la valeur normalisée)
  const ibanSpaced = text.match(RE_IBAN_SPACED);
  if (ibanSpaced) res.iban = ibanSpaced[0].replace(/\s/g, "").toUpperCase();

  const nir = text.match(RE_NIR);
  if (nir) res.nir = nir[0].replace(/[ .]/g, "");

  // Téléphone & code postal : on neutralise d'abord IBAN et NIR.
  let forScan = text;
  if (ibanSpaced) forScan = forScan.replace(RE_IBAN_SPACED, " ");
  if (nir) forScan = forScan.replace(RE_NIR, " ");

  const phone = forScan.match(RE_PHONE);
  if (phone) res.phone = phone[0].replace(/[ .]/g, "");

  const postal = forScan.match(RE_POSTAL);
  if (postal) res.postalCode = postal[0];

  const dob = text.match(RE_DOB);
  if (dob) res.birthDate = `${dob[3]}-${dob[2]}-${dob[1]}`;

  return res;
}
