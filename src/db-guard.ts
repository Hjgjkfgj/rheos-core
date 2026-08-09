// Garde-fous base de données (Lot 10). La RLS est CONTOURNÉE par un rôle
// superutilisateur : en production, l'application doit refuser de démarrer si
// elle est connectée avec un tel rôle (ADR-006, défense en profondeur).
type RawClient = { $queryRawUnsafe: (q: string) => Promise<any[]> };

/// Vrai si le rôle courant de la connexion est superutilisateur.
export async function isSuperuser(client: RawClient): Promise<boolean> {
  const rows = await client.$queryRawUnsafe(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`);
  return rows?.[0]?.rolsuper === true;
}

/// Refuse le démarrage en production si le rôle est superutilisateur (RLS inopérante).
export async function assertNonSuperuserInProd(client: RawClient): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  if (await isSuperuser(client)) {
    throw new Error(
      "Refus de démarrage : la base est connectée avec un rôle SUPERUTILISATEUR — " +
      "la Row-Level Security serait contournée. Utilisez le rôle applicatif " +
      "non-superutilisateur (ex. rheos_app) via DATABASE_URL."
    );
  }
}
