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

/// Refuse le démarrage en production si le rôle contourne la RLS (superuser OU bypassrls).
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
}
