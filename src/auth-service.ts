// Service d'authentification : login (email/mot de passe) → JWT.
// Hachage scrypt (crypto natif). Utilisateurs en mémoire pour le MVP ;
// en production, portés par le Repository (table User) + fournisseur d'identité.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { signToken } from "./jwt.js";
import { AppError } from "./types.js";
import { defaultScopesFor } from "./auth.js";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  const dk = scryptSync(pw, salt, 32).toString("hex");
  return `${salt}:${dk}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, dk] = stored.split(":");
  const calc = scryptSync(pw, salt, 32);
  const a = Buffer.from(dk, "hex");
  return a.length === calc.length && timingSafeEqual(a, calc);
}

interface UserRec { email: string; userId: string; tenantId: string; roles: string[]; personId?: string; passwordHash: string; }

export class AuthService {
  private users: UserRec[] = [];

  seedDemo() {
    const add = (email: string, userId: string, tenantId: string, roles: string[], pw: string) =>
      this.users.push({ email, userId, tenantId, roles, passwordHash: hashPassword(pw) });
    add("rh@acme", "rh", "ACME", ["HrManager"], "secret");
    add("dg@acme", "dg", "ACME", ["Signatory"], "secret");
    add("admin@acme", "admin", "ACME", ["TenantAdmin"], "secret");
  }

  login(email: string, password: string): string {
    const u = this.users.find((x) => x.email === email);
    if (!u || !verifyPassword(password, u.passwordHash)) {
      throw new AppError(401, "invalid_credentials", "Identifiants invalides");
    }
    return signToken({ sub: u.userId, tenantId: u.tenantId, roles: u.roles, personId: u.personId, scopes: defaultScopesFor(u.roles) });
  }
}
