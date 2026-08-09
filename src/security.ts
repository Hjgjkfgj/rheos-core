// Durcissement HTTP (Lot 8) — sans dépendance (pas de plugin lourd).
// En-têtes de sécurité + rate limiting en mémoire. Le rate limiter est volontairement
// simple (fenêtre glissante par IP) ; en production, préférer un store partagé (Redis).

export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "SAMEORIGIN",
  "referrer-policy": "no-referrer",
  "x-dns-prefetch-control": "off",
  "permissions-policy": "geolocation=(), camera=(), microphone=()",
  "cross-origin-opener-policy": "same-origin",
};

interface Bucket { count: number; resetAt: number }

/// Rate limiter à fenêtre fixe par clé (IP + tranche de chemin).
export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  constructor(private windowMs: number, private max: number) {}

  /// now injecté (déterminisme des tests). Retourne true si la requête est autorisée.
  hit(key: string, now: number): { allowed: boolean; remaining: number; resetAt: number } {
    let b = this.buckets.get(key);
    if (!b || now >= b.resetAt) { b = { count: 0, resetAt: now + this.windowMs }; this.buckets.set(key, b); }
    b.count++;
    return { allowed: b.count <= this.max, remaining: Math.max(0, this.max - b.count), resetAt: b.resetAt };
  }
}

/// Limites par famille de routes. /auth est plus strict (anti bruteforce).
export function limitFor(path: string): { windowMs: number; max: number } {
  if (path.startsWith("/api/v1/auth")) return { windowMs: 60_000, max: 20 };   // 20 tentatives / min
  if (path.startsWith("/api/v1")) return { windowMs: 60_000, max: 300 };       // 300 req / min
  return { windowMs: 60_000, max: 600 };
}
