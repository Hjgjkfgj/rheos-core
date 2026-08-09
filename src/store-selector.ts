// Sélection de l'implémentation de persistance via la variable d'env STORE.
//   STORE=memory  (défaut) → MemoryRepository (dev/tests)
//   STORE=prisma           → PrismaRepository (PostgreSQL + RLS)
// L'import de Prisma est dynamique : le mode mémoire ne dépend pas de @prisma/client.
import { Repository, MemoryRepository } from "./repository.js";

export async function getRepository(): Promise<Repository> {
  const mode = process.env.STORE ?? "memory";
  if (mode === "prisma") {
    const { PrismaClient } = await import("@prisma/client");
    const { PrismaRepository } = await import("./prisma-repository.js");
    const { assertNonSuperuserInProd } = await import("./db-guard.js");
    const client = new PrismaClient();
    await assertNonSuperuserInProd(client); // refuse le superutilisateur en prod (RLS)
    return new PrismaRepository(client);
  }
  return new MemoryRepository();
}
