// Rhéos — Commande d'anonymisation en fin de rétention (Lot 17, RGPD).
//   STORE=prisma DATABASE_URL="..." npx tsx scripts/anonymize-person.ts <TENANT_ID> <PERSON_ID>
// Anonymise l'identité, purge les valeurs sensibles chiffrées (IBAN/NIR) et anonymise
// les documents (mécanique DELETE/ANONYMIZE/ARCHIVE existante). Refuse si une relation
// de travail est encore active. Journalisé (audit + événement PersonAnonymized).
import { getRepository } from "../src/store-selector.js";
import { EventBus } from "../src/events.js";
import { MvpServices } from "../src/services-mvp.js";
import { PrivacyService } from "../src/services-privacy.js";

const [, , tenantId, personId] = process.argv;
if (!tenantId || !personId) {
  console.error("Usage : tsx scripts/anonymize-person.ts <TENANT_ID> <PERSON_ID>");
  process.exit(2);
}

const repo = await getRepository();
const bus = new EventBus();
bus.onPersist = (e) => { void repo.appendDomainEvent(e); };
const mvp = new MvpServices(repo, bus);
const privacy = new PrivacyService(repo, bus, mvp);
const ctx = { tenantId, userId: "anonymization-job", roles: ["TenantAdmin"], scopes: [{ type: "TENANT" as const }] };

try {
  const res = await privacy.anonymizePerson(ctx, personId);
  console.log(`✓ Personne ${personId} anonymisée :`, JSON.stringify(res));
  process.exit(0);
} catch (e: any) {
  console.error(`✗ Échec : ${e.message}`);
  process.exit(1);
}
