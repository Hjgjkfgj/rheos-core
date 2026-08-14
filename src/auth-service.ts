// Service d'authentification : login (email/mot de passe) → JWT.
// Hachage scrypt (crypto natif). Deux sources de comptes :
//   1) PERSISTANTS en base (`AuthAccount`, table plateforme hors RLS) — source de
//      vérité en production ; mots de passe réinitialisables, sessions invalidables.
//   2) DÉMO en mémoire (`seedDemo`) — repli pour le dev local et les tests.
import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { signToken } from "./jwt.js";
import { AppError, AuthAccount } from "./types.js";
import { defaultScopesFor } from "./auth.js";
import { Repository } from "./repository.js";
import { uid } from "./store.js";

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

export interface LoginResult { token: string; mustChangePassword: boolean; }

interface UserRec { email: string; userId: string; tenantId: string; roles: string[]; personId?: string; passwordHash: string; }

export class AuthService {
  private users: UserRec[] = [];
  constructor(private repo?: Repository) {}

  seedDemo() {
    const add = (email: string, userId: string, tenantId: string, roles: string[], pw: string) =>
      this.users.push({ email, userId, tenantId, roles, passwordHash: hashPassword(pw) });
    add("rh@acme", "rh", "ACME", ["HrManager"], "secret");
    add("dg@acme", "dg", "ACME", ["Signatory"], "secret");
    add("admin@acme", "admin", "ACME", ["TenantAdmin"], "secret");
    // Tenant DEMO (jeu de démonstration seedé) — support de la visite guidée commerciale.
    add("admin@demo", "admin-demo", "DEMO", ["TenantAdmin"], "secret");
    add("dg@demo", "dg-demo", "DEMO", ["Signatory"], "secret");
    // Tenant PILOTE — neuf et vide, pour la recette client (docs/pilote/scenario-recette.md).
    add("admin@pilote", "admin-pilote", "PILOTE", ["TenantAdmin"], "pilote2026");
    add("dg@pilote", "dg-pilote", "PILOTE", ["Signatory"], "pilote2026");
  }

  async login(email: string, password: string): Promise<LoginResult> {
    // 1) Compte persistant (production). Le token porte tokenVersion (invalidation au reset).
    if (this.repo) {
      const acc = await this.repo.getAuthAccountByEmail(email);
      if (acc) {
        if (acc.disabled || !verifyPassword(password, acc.passwordHash)) {
          throw new AppError(401, "invalid_credentials", "Identifiants invalides");
        }
        const token = signToken({
          sub: acc.id, tenantId: acc.tenantId, roles: acc.roleNames, personId: acc.personId,
          scopes: acc.scopes, tv: acc.tokenVersion, mustChangePassword: acc.mustChangePassword,
        });
        return { token, mustChangePassword: acc.mustChangePassword };
      }
    }
    // 2) Repli : comptes de démonstration en mémoire (dev/tests).
    const u = this.users.find((x) => x.email === email);
    if (!u || !verifyPassword(password, u.passwordHash)) {
      throw new AppError(401, "invalid_credentials", "Identifiants invalides");
    }
    const token = signToken({ sub: u.userId, tenantId: u.tenantId, roles: u.roles, personId: u.personId, scopes: defaultScopesFor(u.roles) });
    return { token, mustChangePassword: false };
  }

  /// Crée un compte d'authentification PERSISTANT (script user:create, reset RH).
  /// Mot de passe haché (jamais stocké ni loggé en clair). Échoue si l'email existe.
  async createAccount(input: {
    email: string; tenantId: string; roleNames: string[]; password: string;
    personId?: string; scopes?: AuthAccount["scopes"]; mustChangePassword?: boolean;
  }): Promise<AuthAccount> {
    if (!this.repo) throw new AppError(500, "no_store", "Un store persistant (STORE=prisma) est requis pour créer un compte.");
    if (await this.repo.getAuthAccountByEmail(input.email)) {
      throw new AppError(409, "already_exists", "Un compte existe déjà avec cet email.");
    }
    const acc: AuthAccount = {
      id: uid(), email: input.email, tenantId: input.tenantId, personId: input.personId,
      passwordHash: hashPassword(input.password), roleNames: input.roleNames, scopes: input.scopes,
      tokenVersion: 0, mustChangePassword: input.mustChangePassword ?? false, disabled: false,
      createdAt: new Date().toISOString(),
    };
    return this.repo.createAuthAccount(acc);
  }
}
