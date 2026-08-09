// Chiffrement au repos des données sensibles (Lot 11) — IBAN, NIR.
// AES-256-GCM ; clé dérivée de ENCRYPTION_KEY (env). En production, fournir une
// clé forte et la faire tourner ; ne jamais exposer la valeur claire par l'API
// (seul un accès habilité + audité la déchiffre).
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const KEY = scryptSync(process.env.ENCRYPTION_KEY ?? "dev-encryption-key-change-me", "rheos-crypto-salt", 32);

/// Chiffre une valeur → "iv:tag:ciphertext" (hex).
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

/// Déchiffre "iv:tag:ciphertext".
export function decrypt(blob: string): string {
  const [ivh, tagh, ench] = blob.split(":");
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivh, "hex"));
  d.setAuthTag(Buffer.from(tagh, "hex"));
  return Buffer.concat([d.update(Buffer.from(ench, "hex")), d.final()]).toString("utf8");
}

/// 4 derniers caractères (affichage masqué : ibanLast4).
export const last4 = (s: string) => s.replace(/\s/g, "").slice(-4);
