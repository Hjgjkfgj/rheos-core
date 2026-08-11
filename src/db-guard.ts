// Garde-fous base de données (Lot 10). La RLS est CONTOURNÉE par un rôle
// superutilisateur : en production, l'application doit refuser de démarrer si
// elle est connectée avec un tel rôle (ADR-006, défense en profondeur).
type RawClient = { $queryRawUnsafe: (q: string) => Promise<any[]> };

/// Attributs de sécurité du rôle courant.
export async function roleAttrs(client: RawClient): Promise<{ superuser: boolean; bypassRls: boolean }> {
  const rows = await client.$queryRawUnsafe(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
  return { superuser: rows?.[0]?.rolsuper === true, bypassRls: rows?.[0]?.rolbypassrls === true };
}

/// Vrai si le rôle courant est superutilisateur.
export async function isSuperuser(client: RawClient): Promise<boolean> {
  return (await roleAttrs(client)).superuser;
}

/// Vrai si le rôle courant POSSÈDE des tables du schéma public. Un propriétaire de table
/// contourne la RLS "par la propriété" tant que FORCE ROW LEVEL SECURITY n'est pas posé
/// (on l'a volontairement retiré pour permettre pg_dump/restore par l'admin). L'app ne
/// doit donc JAMAIS tourner avec ce rôle : elle doit utiliser rheos_app (non-propriétaire).
export async function ownsPublicTables(client: RawClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe(
    `SELECT count(*)::int AS c FROM pg_tables WHERE schemaname = 'public' AND tableowner = current_user`);
  return (rows?.[0]?.c ?? 0) > 0;
}

/// Refuse le démarrage en production si le rôle contourne la RLS : superuser, bypassrls,
/// OU propriétaire des tables (bypass par la propriété, cf. NO FORCE). L'app doit tourner
/// avec rheos_app (non-superutilisateur, NOBYPASSRLS, non-propriétaire, DML seul).
export async function assertNonSuperuserInProd(client: RawClient): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const a = await roleAttrs(client);
  if (a.superuser || a.bypassRls) {
    throw new Error(
      "Refus de démarrage : la base est connectée avec un rôle qui CONTOURNE la RLS " +
      `(superuser=${a.superuser}, bypassrls=${a.bypassRls}). Utilisez le rôle applicatif ` +
      "non-superutilisateur (rheos_app, NOBYPASSRLS) via DATABASE_URL."
    );
  }
  if (await ownsPublicTables(client)) {
    throw new Error(
      "Refus de démarrage : la base est connectée avec le rôle PROPRIÉTAIRE des tables " +
      "(il contourne la RLS par la propriété). Utilisez le rôle applicatif rheos_app " +
      "(non-propriétaire, DML seul) via DATABASE_URL — jamais le rôle admin/migrations."
    );
  }
}
