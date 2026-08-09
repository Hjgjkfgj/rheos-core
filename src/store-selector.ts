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
    return new PrismaRepository(new PrismaClient());
  }
  return new MemoryRepository();
}
