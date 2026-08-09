// JWT HS256 sans dépendance (crypto natif). En production : secret fort via env,
// rotation des clés, et vérification au niveau de l'API Gateway (ADR-006).
import { createHmac, timingSafeEqual } from "crypto";
import { Scope } from "./types.js";

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const secretOf = (s?: string) => s ?? process.env.JWT_SECRET ?? "dev-secret-change-me";

export interface TokenPayload {
  sub: string;        // userId
  tenantId: string;
  roles: string[];
  personId?: string;
  scopes?: Scope[];   // périmètres ABAC (TENANT/LEGAL_ENTITY/ESTABLISHMENT/ORG_UNIT/SELF)
  iat?: number;
  exp?: number;
}

export function signToken(payload: Omit<TokenPayload, "iat" | "exp">, opts: { expiresInSec?: number; secret?: string } = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const body: TokenPayload = { ...payload, iat: now, exp: now + (opts.expiresInSec ?? 8 * 3600) };
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const data = `${head}.${b64url(JSON.stringify(body))}`;
  const sig = createHmac("sha256", secretOf(opts.secret)).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyToken(token: string, secret?: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("token malformé");
  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac("sha256", secretOf(secret)).update(data).digest("base64url");
  const a = Buffer.from(parts[2]); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("signature invalide");
  const body = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as TokenPayload;
  if (body.exp && Math.floor(Date.now() / 1000) > body.exp) throw new Error("token expiré");
  return body;
}
