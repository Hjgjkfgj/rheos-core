// Rhéos — chiffrement du CONTENU documentaire (Lot 19). AES-256-GCM, clé dérivée
// PAR TENANT depuis ENCRYPTION_KEY (isolation cryptographique entre entreprises :
// même une fuite du bucket ne livre pas les documents en clair sans la clé maître).
// Format du blob : iv(12) | authTag(16) | ciphertext.
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const base = () => process.env.ENCRYPTION_KEY ?? "dev-encryption-key-change-me";
// Clé distincte par tenant (sel = identifiant du tenant).
export const tenantDocKey = (tenantId: string): Buffer => scryptSync(base(), `rheos-doc-${tenantId}`, 32);

export function encryptBytes(tenantId: string, data: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", tenantDocKey(tenantId), iv);
  const enc = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function decryptBytes(tenantId: string, blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12), tag = blob.subarray(12, 28), enc = blob.subarray(28);
  const d = createDecipheriv("aes-256-gcm", tenantDocKey(tenantId), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]);
}
