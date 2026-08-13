// Rhéos — abstraction de stockage du CONTENU documentaire (Lot 19). Deux
// implémentations : mémoire (tests/dev) et S3/Object Storage (staging/prod).
// Sélection par variables d'environnement (comme STORE pour la base).
import { S3Config, s3Put, s3Get, s3Delete } from "./domain/s3.js";

export interface DocumentStore {
  readonly kind: string;
  put(key: string, bytes: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/// Store mémoire — le contenu chiffré vit en RAM (tests, dev sans bucket).
export class MemoryDocumentStore implements DocumentStore {
  readonly kind = "memory";
  private m = new Map<string, Buffer>();
  async put(key: string, bytes: Buffer) { this.m.set(key, Buffer.from(bytes)); }
  async get(key: string) { const v = this.m.get(key); if (!v) throw new Error(`objet introuvable : ${key}`); return v; }
  async delete(key: string) { this.m.delete(key); }
}

/// Store S3 — contenu chiffré poussé dans le bucket Object Storage.
export class S3DocumentStore implements DocumentStore {
  readonly kind = "s3";
  constructor(private cfg: S3Config) {}
  put(key: string, bytes: Buffer, contentType?: string) { return s3Put(this.cfg, key, bytes, contentType); }
  get(key: string) { return s3Get(this.cfg, key); }
  delete(key: string) { return s3Delete(this.cfg, key); }
}

/// Sélection : bucket + clés S3 présents → S3, sinon mémoire.
export function getDocumentStore(): DocumentStore {
  const bucket = process.env.DOCUMENTS_BUCKET;
  if (bucket && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) {
    return new S3DocumentStore({
      endpoint: process.env.S3_ENDPOINT ?? "https://s3.fr-par.scw.cloud",
      region: process.env.S3_REGION ?? "fr-par",
      bucket, accessKey: process.env.S3_ACCESS_KEY, secretKey: process.env.S3_SECRET_KEY,
    });
  }
  return new MemoryDocumentStore();
}
