import { build } from "./app.js";
import { getRepository } from "./store-selector.js";

// Secrets hors code : en production, JWT_SECRET doit être fourni (pas de repli).
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16)) {
  throw new Error("JWT_SECRET manquant ou trop court en production (secret fort requis, ≥ 16 caractères).");
}

const repo = await getRepository(); // STORE=memory (défaut) | STORE=prisma
const app = build(repo);
const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  console.log(`rheos-core (${process.env.STORE ?? "memory"}) en écoute sur http://localhost:${port}`);
});
