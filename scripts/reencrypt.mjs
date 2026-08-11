#!/usr/bin/env node
// Rhéos — re-chiffrement des données sensibles lors d'une rotation d'ENCRYPTION_KEY (Lot 15).
// Déchiffre chaque IBAN/NIR avec l'ANCIENNE clé et re-chiffre avec la NOUVELLE.
// Opération de maintenance : connexion ADMIN (parcourt tous les tenants).
//   OLD_ENCRYPTION_KEY   ancienne clé
//   ENCRYPTION_KEY       nouvelle clé
//   DATABASE_URL_ADMIN   URL admin
//   node scripts/reencrypt.mjs        (ajouter --dry pour simuler)
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import { PrismaClient } from "@prisma/client";

const key = (s) => scryptSync(s, "rheos-crypto-salt", 32); // même dérivation que src/crypto.ts
const dec = (blob, k) => { const [iv, tag, e] = blob.split(":"); const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "hex")); d.setAuthTag(Buffer.from(tag, "hex")); return Buffer.concat([d.update(Buffer.from(e, "hex")), d.final()]).toString("utf8"); };
const enc = (plain, k) => { const iv = randomBytes(12); const c = createCipheriv("aes-256-gcm", k, iv); const e = Buffer.concat([c.update(plain, "utf8"), c.final()]); return `${iv.toString("hex")}:${c.getAuthTag().toString("hex")}:${e.toString("hex")}`; };

const need = (n) => { const v = process.env[n]; if (!v) { console.error(`Manque ${n}`); process.exit(2); } return v; };
const DRY = process.argv.includes("--dry");

async function main() {
  const OLD = key(need("OLD_ENCRYPTION_KEY")), NEW = key(need("ENCRYPTION_KEY"));
  const db = new PrismaClient({ datasources: { db: { url: need("DATABASE_URL_ADMIN") } } });
  let n = 0;
  for (const [model, col] of [["bankAccount", "ibanEnc"], ["sensitiveIdentifier", "valueEnc"]]) {
    const rows = await db[model].findMany();
    for (const r of rows) {
      const plain = dec(r[col], OLD);        // échoue si l'ancienne clé est mauvaise
      if (!DRY) await db[model].update({ where: { id: r.id }, data: { [col]: enc(plain, NEW) } });
      n++;
    }
  }
  await db.$disconnect();
  console.log(`${DRY ? "[dry] " : ""}✓ ${n} valeur(s) re-chiffrée(s) (IBAN + identifiants sensibles).`);
}
main().catch((e) => { console.error("Erreur:", e.message); process.exit(1); });
