// Assemblage Fastify : routes /api/v1 pour D1 + D2. Auth simulée par en-tête
// x-rheos-user (base64 JSON {tenantId,userId,roles,personId}) ; en production,
// remplacé par un JWT (API Gateway, ADR-006). Le tenant vient du token, jamais d'un paramètre.
import Fastify from "fastify";
import { readFileSync } from "fs";
import { EventBus } from "./events.js";
import { Services } from "./services.js";
import { MvpServices } from "./services-mvp.js";
import { NotificationService } from "./services-notifications.js";
import { RhOfficerService } from "./services-rh-officer.js";
import { TimeService } from "./services-time.js";
import { OrgService } from "./services-org.js";
import { MeService } from "./services-me.js";
import { DeadlineService } from "./services-deadlines.js";
import { SocialService } from "./services-social.js";
import { AuthorityService } from "./services-authority.js";
import { HealthService } from "./services-health.js";
import { CareerService } from "./services-career.js";
import { FinanceService } from "./services-finance.js";
import { signToken } from "./jwt.js";
import { Repository, MemoryRepository } from "./repository.js";
import { AuthService } from "./auth-service.js";
import { verifyToken } from "./jwt.js";
import { conventionGrid, resolveValeurPoint, minimumForCoef } from "./domain/convention.js";
import { analyzeDocument } from "./domain/extraction.js";
import { assertCan } from "./auth.js";
import { AssistantService } from "./services-assistant.js";
import { SensitiveService } from "./services-sensitive.js";
import { ImportService } from "./services-import.js";
import { PrivacyService } from "./services-privacy.js";
import { getDocumentStore } from "./doc-store.js";
import { RegulatoryService } from "./services-regulatory.js";
import { SECURITY_HEADERS, RateLimiter } from "./security.js";
import { uid } from "./store.js";
import { Ctx, AppError } from "./types.js";

export function build(repo: Repository = new MemoryRepository()) {
  const bus = new EventBus();
  bus.onPersist = (e) => { void repo.appendDomainEvent(e); };
  const svc = new Services(repo, bus);
  const docStore = getDocumentStore(); // stockage du contenu documentaire (mémoire ou S3/Object Storage)
  const mvp = new MvpServices(repo, bus, undefined, docStore);
  const notifications = new NotificationService(repo);
  const rhOfficer = new RhOfficerService(repo, notifications);
  const timeSvc = new TimeService(repo, bus);
  const orgSvc = new OrgService(repo);
  const meSvc = new MeService(repo, mvp);
  const deadlineSvc = new DeadlineService(repo, bus);
  const socialSvc = new SocialService(repo, bus);
  const authoritySvc = new AuthorityService(repo, bus);
  const healthSvc = new HealthService(repo, bus);
  const careerSvc = new CareerService(repo, bus);
  const financeSvc = new FinanceService(repo, bus);
  const sensitiveSvc = new SensitiveService(repo, bus);
  const importSvc = new ImportService(repo, bus, svc);
  const privacySvc = new PrivacyService(repo, bus, mvp);
  const regulatorySvc = new RegulatoryService(repo, bus);
  // Archivage automatique du coffre au départ du collaborateur (le coffre n'est
  // jamais détruit ; le collaborateur garde l'accès à ses documents).
  bus.subscribe((e) => {
    if (e.type !== "EmployeeDeparture") return;
    void (async () => {
      const emp = await repo.getEmployment(e.tenantId, e.aggregateId);
      if (emp) await mvp.archivePersonDocuments(e.tenantId, emp.personId, e.actorUserId);
    })();
  });
  const authService = new AuthService();
  authService.seedDemo();
  const app = Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 }); // imports CSV volumineux (base64)

  app.decorateRequest("ctx", null);

  // Durcissement : en-têtes de sécurité sur toutes les réponses + rate limiting.
  const authLimiter = new RateLimiter(60_000, 20);
  const apiLimiter = new RateLimiter(60_000, 300);
  const isProd = process.env.NODE_ENV === "production";
  app.addHook("onRequest", async (req, reply) => {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) reply.header(k, v);
    // Derrière la terminaison TLS de Scaleway : le container reçoit du HTTP avec
    // x-forwarded-proto. En prod : HSTS + redirection HTTPS (hors /health, pour la sonde).
    if (isProd) {
      reply.header("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
      const proto = (req.headers["x-forwarded-proto"] as string || "").split(",")[0].trim();
      if (proto === "http" && !req.url.startsWith("/health")) {
        const host = req.headers["host"];
        reply.code(308).header("location", `https://${host}${req.url}`).send();
        return;
      }
    }
    if (!req.url.startsWith("/api/v1")) return;
    const limiter = req.url.startsWith("/api/v1/auth") ? authLimiter : apiLimiter;
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
    const r = limiter.hit(`${ip}:${req.url.startsWith("/api/v1/auth") ? "auth" : "api"}`, Date.now());
    reply.header("x-ratelimit-remaining", String(r.remaining));
    if (!r.allowed) { reply.code(429).send({ code: "rate_limited", message: "Trop de requêtes, réessayez plus tard." }); }
  });

  app.addHook("preHandler", async (req, reply) => {
    // Seules les routes /api/v1/* (hors /auth/*) exigent un jeton ; le front statique est public.
    const needsAuth = req.url.startsWith("/api/v1") && !req.url.startsWith("/api/v1/auth/");
    if (!needsAuth) return;
    const authz = req.headers["authorization"];
    if (!authz || !authz.startsWith("Bearer ")) {
      reply.code(401).send({ code: "unauthorized", message: "Jeton Bearer requis" }); return;
    }
    try {
      const p = verifyToken(authz.slice(7));
      (req as any).ctx = { tenantId: p.tenantId, userId: p.sub, roles: p.roles ?? [], personId: p.personId, scopes: p.scopes } as Ctx;
    } catch (e: any) {
      reply.code(401).send({ code: "unauthorized", message: `Jeton invalide : ${e.message}` });
    }
  });

  // Authentification (public). Renvoie le jeton + la destination selon le rôle
  // (collaborateur pur → espace PWA ; tout profil de gestion → console). La correspondance
  // rôle→espace est calculée côté serveur (source unique de vérité).
  app.post("/api/v1/auth/login", async (req) => {
    const { email, password } = (req.body as any) ?? {};
    const token = authService.login(email, password);
    const roles = verifyToken(token).roles ?? [];
    const isCollaborator = roles.length > 0 && roles.every((r) => r === "Employee");
    return { token, roles, redirect: isCollaborator ? "/espace" : "/console" };
  });

  // Jeton de démonstration — DEV UNIQUEMENT (désactivé en production).
  app.post("/api/v1/auth/dev-token", async (req, reply) => {
    if (process.env.NODE_ENV === "production") { reply.code(403); return { code: "forbidden", message: "Désactivé en production" }; }
    const b = (req.body as any) ?? {};
    return { token: signToken({ sub: b.sub ?? "demo", tenantId: b.tenantId, roles: b.roles ?? ["Employee"], personId: b.personId }) };
  });

  // Porte d'entrée unique : la racine sert UNIQUEMENT la page de connexion (Lot UI-1).
  // La console et l'espace ne sont servis que sur leurs routes dédiées ; sans jeton en
  // localStorage ils renvoient vers « / » (garde de confort ; la sécurité reste côté API).
  const web = (f: string) => new URL(`../web/${f}`, import.meta.url);
  const html = (reply: any, f: string) => { reply.header("content-type", "text/html; charset=utf-8"); return readFileSync(web(f), "utf8"); };
  app.get("/", async (_req, reply) => html(reply, "login.html"));
  app.get("/console", async (_req, reply) => html(reply, "index.html"));
  // Espace collaborateur — PWA (page + manifest + service worker + icône, publics)
  app.get("/espace", async (_req, reply) => html(reply, "espace.html"));
  // Lot 17 — Politique de confidentialité + mentions légales (page publique).
  app.get("/confidentialite", async (_req, reply) => { reply.header("content-type", "text/html; charset=utf-8"); return readFileSync(web("confidentialite.html"), "utf8"); });
  app.get("/manifest.webmanifest", async (_req, reply) => { reply.header("content-type", "application/manifest+json; charset=utf-8"); return readFileSync(web("manifest.webmanifest"), "utf8"); });
  app.get("/sw.js", async (_req, reply) => { reply.header("content-type", "text/javascript; charset=utf-8"); reply.header("service-worker-allowed", "/"); return readFileSync(web("sw.js"), "utf8"); });
  app.get("/icon.svg", async (_req, reply) => { reply.header("content-type", "image/svg+xml; charset=utf-8"); return readFileSync(web("icon.svg"), "utf8"); });
  for (const png of ["icon-192.png", "icon-512.png"]) {
    app.get(`/${png}`, async (_req, reply) => { reply.header("content-type", "image/png"); return readFileSync(web(png)); });
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ code: err.code, message: err.message, details: err.details });
    return reply.code(500).send({ code: "internal", message: "Erreur interne" });
  });

  const ctx = (req: any): Ctx => req.ctx;

  app.get("/health", async (_req, reply) => {
    const db = await repo.ping().catch(() => false);
    if (!db) reply.code(503);
    return { status: db ? "ok" : "degraded", store: process.env.STORE ?? "memory", db, ts: new Date().toISOString() };
  });

  // D1
  app.get("/api/v1/companies", async (req) => {
    const q = req.query as any;
    return svc.listLegalEntities(ctx(req), { page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined });
  });
  app.post("/api/v1/companies", async (req, reply) => { reply.code(201); return svc.createLegalEntity(ctx(req), req.body as any); });
  app.get("/api/v1/companies/:companyId", async (req) => svc.getLegalEntity(ctx(req), (req.params as any).companyId));
  app.get("/api/v1/companies/:companyId/establishments", async (req) => svc.listEstablishments(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/establishments", async (req, reply) => {
    reply.code(201); return svc.createEstablishment(ctx(req), (req.params as any).companyId, req.body as any);
  });
  app.post("/api/v1/establishments/:establishmentId/close", async (req) =>
    svc.closeEstablishment(ctx(req), (req.params as any).establishmentId, req.body as any));
  app.post("/api/v1/establishments/:establishmentId/operating-sites", async (req, reply) => {
    reply.code(201); return svc.createOperatingSite(ctx(req), (req.params as any).establishmentId, (req.body as any).name);
  });
  app.post("/api/v1/companies/:companyId/positions", async (req, reply) => {
    reply.code(201); return svc.createPosition(ctx(req), (req.params as any).companyId, req.body as any);
  });
  // Convention collective / accords datés (rattachement)
  app.get("/api/v1/companies/:companyId/agreements", async (req) => svc.listAgreements(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/agreements", async (req, reply) => { reply.code(201); return svc.linkAgreement(ctx(req), (req.params as any).companyId, req.body as any); });
  // Cycle de vie d'une obligation (DETECTED→…→ARCHIVED)
  app.post("/api/v1/obligations/:id/status", async (req) => svc.advanceObligation(ctx(req), (req.params as any).id, (req.body as any)?.status));
  app.get("/api/v1/companies/:companyId/registry", async (req) => svc.getRegistry(ctx(req), (req.params as any).companyId, { establishmentId: (req.query as any).establishmentId }));

  // Lot 16 — Import massif de collaborateurs (CSV) : préversion (dry-run) puis commit.
  app.post("/api/v1/companies/:companyId/import/preview", async (req) => importSvc.preview(ctx(req), (req.params as any).companyId, req.body as any));
  app.post("/api/v1/companies/:companyId/import/commit", async (req) => importSvc.commit(ctx(req), (req.params as any).companyId, req.body as any));
  // Lot 16 — Export miroir (réversibilité + portabilité RGPD) : CSV ou JSON.
  const sendExport = (reply: any, out: { contentType: string; filename: string; body: string }) => {
    reply.header("content-type", out.contentType);
    reply.header("content-disposition", `attachment; filename="${out.filename}"`);
    return out.body;
  };
  app.get("/api/v1/companies/:companyId/collaborators/export", async (req, reply) => sendExport(reply, await importSvc.exportCollaborators(ctx(req), { companyId: (req.params as any).companyId, format: (req.query as any).format })));
  app.get("/api/v1/collaborators/export", async (req, reply) => sendExport(reply, await importSvc.exportCollaborators(ctx(req), { format: (req.query as any).format })));
  // Modèle CSV commenté à remettre au pilote.
  app.get("/api/v1/import/template", async (_req, reply) => {
    reply.header("content-type", "text/csv; charset=utf-8");
    reply.header("content-disposition", 'attachment; filename="modele-import-collaborateurs.csv"');
    return readFileSync(new URL("../docs/modele-import-collaborateurs.csv", import.meta.url), "utf8");
  });

  // R1 — Référentiel réglementaire (PLATEFORME, lecture pour tout tenant authentifié).
  app.get("/api/v1/regulatory/agreements/:idcc", async (req) => regulatorySvc.getAgreement((req.params as any).idcc));

  // Lot 17 — Droits des personnes (RGPD). Droit d'accès (JSON ou PDF, journalisé) + anonymisation.
  app.get("/api/v1/persons/:personId/access-request", async (req, reply) => {
    const personId = (req.params as any).personId;
    if (((req.query as any).format || "json").toLowerCase() === "pdf") {
      const buf = await privacySvc.accessRequestPdf(ctx(req), personId);
      reply.header("content-type", "application/pdf");
      reply.header("content-disposition", 'attachment; filename="droit-d-acces.pdf"');
      return reply.send(buf);
    }
    return privacySvc.accessRequest(ctx(req), personId);
  });
  app.post("/api/v1/persons/:personId/anonymize", async (req) => privacySvc.anonymizePerson(ctx(req), (req.params as any).personId));
  // Accès collaborateur (recette pilote) : le RH génère un lien magique vers l'espace
  // self-service, scopé à CETTE personne (rôle Employee). Remplace dev-token en production.
  app.post("/api/v1/persons/:personId/access-token", async (req) => {
    const c = ctx(req);
    assertCan(c, "person.write");
    const personId = (req.params as any).personId;
    const p = await repo.getPerson(c.tenantId, personId);
    if (!p) throw new AppError(404, "not_found", "Personne introuvable");
    const token = signToken({ sub: `collab-${personId}`, tenantId: c.tenantId, personId, roles: ["Employee"] }, { expiresInSec: 30 * 24 * 3600 });
    return { token, espaceUrl: `/espace#token=${encodeURIComponent(token)}` };
  });

  // Effectif / seuils / obligations (D1)
  app.get("/api/v1/companies/:companyId/workforce", async (req) => svc.computeWorkforce(ctx(req), (req.params as any).companyId, (req.query as any).asOf));
  app.get("/api/v1/companies/:companyId/obligations", async (req) => svc.listObligations(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/workforce/simulate", async (req) => svc.simulateWorkforce(ctx(req), (req.params as any).companyId, Number((req.body as any)?.additionalHires ?? 0)));

  // Convention collective (datée)
  app.get("/api/v1/conventions/:idcc/grid", async (req) => {
    const date = (req.query as any).date ?? new Date().toISOString().slice(0, 10);
    return conventionGrid((req.params as any).idcc, date);
  });
  app.get("/api/v1/conventions/:idcc/resolve", async (req) => {
    const q = req.query as any;
    const date = q.date ?? new Date().toISOString().slice(0, 10);
    const idcc = (req.params as any).idcc;
    return { idcc, date, valeurPoint: resolveValeurPoint(idcc, date), minimumMensuel: q.coef ? minimumForCoef(idcc, Number(q.coef), date) : undefined };
  });

  // Centre de notifications / alertes
  app.get("/api/v1/notifications", async (req) => notifications.build(ctx(req)));

  // Veille & échéances
  app.get("/api/v1/companies/:companyId/deadlines", async (req) => deadlineSvc.forCompany(ctx(req), (req.params as any).companyId, Number((req.query as any).soonDays ?? 60)));
  app.post("/api/v1/employments/:employmentId/deadlines", async (req, reply) => { reply.code(201); return deadlineSvc.createDeadline(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.post("/api/v1/deadlines/:id/done", async (req) => deadlineSvc.markDone(ctx(req), (req.params as any).id));

  // D8 — Dialogue social / IRP (CSE)
  app.get("/api/v1/companies/:companyId/cse/mandates", async (req) => socialSvc.listMandates(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/cse/mandates", async (req, reply) => { reply.code(201); return socialSvc.addMandate(ctx(req), (req.params as any).companyId, req.body as any); });
  app.get("/api/v1/companies/:companyId/cse/meetings", async (req) => socialSvc.listMeetings(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/cse/meetings", async (req, reply) => { reply.code(201); return socialSvc.planMeeting(ctx(req), (req.params as any).companyId, req.body as any); });
  app.post("/api/v1/cse/meetings/:id/minutes", async (req) => socialSvc.recordMinutes(ctx(req), (req.params as any).id, (req.body as any)?.minutes ?? ""));
  app.get("/api/v1/companies/:companyId/negotiations", async (req) => socialSvc.listNegotiations(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/negotiations", async (req, reply) => { reply.code(201); return socialSvc.openNegotiation(ctx(req), (req.params as any).companyId, req.body as any); });
  app.post("/api/v1/negotiations/:id/status", async (req) => socialSvc.setNegotiationStatus(ctx(req), (req.params as any).id, (req.body as any)?.status, (req.body as any)?.notes));

  // D9 — Institutions & Pouvoirs publics
  app.get("/api/v1/companies/:companyId/authority/interactions", async (req) => authoritySvc.listInteractions(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/authority/interactions", async (req, reply) => { reply.code(201); return authoritySvc.createInteraction(ctx(req), (req.params as any).companyId, req.body as any); });
  app.post("/api/v1/authority/interactions/:id/respond", async (req) => authoritySvc.respond(ctx(req), (req.params as any).id, (req.body as any)?.notes));
  app.post("/api/v1/authority/interactions/:id/close", async (req) => authoritySvc.close(ctx(req), (req.params as any).id));

  // D6 — Santé, Sécurité & Prévention
  app.get("/api/v1/companies/:companyId/risks", async (req) => healthSvc.listRisks(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/risks", async (req, reply) => { reply.code(201); return healthSvc.addRisk(ctx(req), (req.params as any).companyId, req.body as any); });
  app.patch("/api/v1/risks/:id", async (req) => healthSvc.updateRisk(ctx(req), (req.params as any).id, req.body as any));
  app.get("/api/v1/companies/:companyId/duerp", async (req) => healthSvc.duerpSummary(ctx(req), (req.params as any).companyId));
  app.get("/api/v1/companies/:companyId/accidents", async (req) => healthSvc.listAccidents(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/accidents", async (req, reply) => { reply.code(201); return healthSvc.declareAccident(ctx(req), (req.params as any).companyId, req.body as any); });

  // D7 — Carrière, Compétences & Formation
  app.get("/api/v1/employments/:employmentId/competencies", async (req) => careerSvc.listCompetencies(ctx(req), (req.params as any).employmentId));
  app.post("/api/v1/employments/:employmentId/competencies", async (req, reply) => { reply.code(201); return careerSvc.addCompetency(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.get("/api/v1/employments/:employmentId/reviews", async (req) => careerSvc.listReviews(ctx(req), (req.params as any).employmentId));
  app.post("/api/v1/employments/:employmentId/reviews", async (req, reply) => { reply.code(201); return careerSvc.planReview(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.post("/api/v1/reviews/:id/hold", async (req) => careerSvc.holdReview(ctx(req), (req.params as any).id, (req.body as any)?.notes));
  app.get("/api/v1/companies/:companyId/trainings", async (req) => careerSvc.listTrainings(ctx(req), (req.params as any).companyId));
  app.post("/api/v1/employments/:employmentId/trainings", async (req, reply) => { reply.code(201); return careerSvc.planTraining(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.post("/api/v1/trainings/:id/complete", async (req) => careerSvc.completeTraining(ctx(req), (req.params as any).id, (req.body as any)?.date));

  // D5 — Pilotage économique & financier
  app.get("/api/v1/companies/:companyId/pilotage", async (req) => financeSvc.pilotage(ctx(req), (req.params as any).companyId, (req.query as any).year ? Number((req.query as any).year) : undefined));
  app.get("/api/v1/companies/:companyId/budgets", async (req) => repo.listBudgetsByCompany((ctx(req) as any).tenantId, (req.params as any).companyId));
  app.post("/api/v1/companies/:companyId/budgets", async (req, reply) => { reply.code(201); return financeSvc.setBudget(ctx(req), (req.params as any).companyId, req.body as any); });
  app.post("/api/v1/companies/:companyId/pilotage/cost-simulate", async (req) => financeSvc.costSimulate(ctx(req), (req.params as any).companyId, req.body as any));

  // Digital RH Officer — briefing quotidien
  app.get("/api/v1/rh-officer/briefing", async (req) => rhOfficer.briefing(ctx(req)));

  // Espace collaborateur (self-service, scopé au token)
  app.get("/api/v1/me", async (req) => meSvc.me(ctx(req)));
  app.get("/api/v1/me/documents", async (req) => meSvc.myDocuments(ctx(req)));
  app.get("/api/v1/me/leaves", async (req) => meSvc.myLeaves(ctx(req), (req.query as any).asOf));
  app.get("/api/v1/me/planning", async (req) => meSvc.myPlanning(ctx(req)));
  app.post("/api/v1/me/leaves", async (req, reply) => { const emp = await meSvc.resolve(ctx(req)); reply.code(201); return mvp.requestLeave(ctx(req), emp.id, req.body as any); });
  app.post("/api/v1/me/clock", async (req, reply) => { const emp = await meSvc.resolve(ctx(req)); reply.code(201); return timeSvc.recordTime(ctx(req), emp.id, req.body as any); });
  // Le collaborateur signe un de SES documents en attente de signature.
  app.post("/api/v1/me/documents/:id/sign", async (req) => mvp.signOwnDocument(ctx(req), (req.params as any).id));

  // Extraction documentaire (R1) — pré-remplissage, NE VAUT JAMAIS validation.
  const assistant = new AssistantService(repo, mvp);
  app.post("/api/v1/extract", async (req) => {
    const c = ctx(req);
    assertCan(c, "person.write");
    const result = analyzeDocument((req.body as any)?.text ?? "");
    // Journalisation IA (données utilisées = l'entrée, jamais stockée ; version).
    await repo.appendAiAudit({ id: uid(), tenantId: c.tenantId, userId: c.userId, kind: "EXTRACTION", dataUsed: ["input:text"], version: "extract-v1", outcome: `${result.documentType}/${result.status}`, at: new Date().toISOString() });
    return result;
  });

  // Assistant de lecture (R2) — réponses depuis les seules données autorisées.
  app.post("/api/v1/assistant/ask", async (req) => assistant.ask(ctx(req), (req.body as any)?.question ?? ""));

  // D2
  app.post("/api/v1/persons", async (req, reply) => { reply.code(201); return svc.createPerson(ctx(req), req.body as any); });
  app.post("/api/v1/employments", async (req, reply) => { reply.code(201); return svc.hire(ctx(req), req.body as any); });
  app.get("/api/v1/employments/:employmentId", async (req) => svc.getEmploymentDetail(ctx(req), (req.params as any).employmentId));
  app.get("/api/v1/employments/:employmentId/employee360", async (req) =>
    svc.employee360(ctx(req), (req.params as any).employmentId, (req.query as any).asOf));
  app.post("/api/v1/employments/:employmentId/assignments", async (req, reply) => {
    reply.code(201); return svc.addAssignment(ctx(req), (req.params as any).employmentId, req.body as any);
  });
  app.post("/api/v1/employments/:employmentId/departure", async (req) =>
    svc.declareDeparture(ctx(req), (req.params as any).employmentId, (req.body as any).endDate, (req.body as any).reason));
  app.post("/api/v1/employments/:employmentId/archive", async (req) => svc.archiveEmployment(ctx(req), (req.params as any).employmentId));
  // Contrat : création autonome (contract.create) → validation (contract.validate) → signature (contract.sign)
  app.post("/api/v1/employments/:employmentId/contracts", async (req, reply) => { reply.code(201); return svc.createContractForEmployment(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.post("/api/v1/contracts/:contractId/validate", async (req) => svc.validateContract(ctx(req), (req.params as any).contractId));
  app.post("/api/v1/contracts/:contractId/sign", async (req) => svc.signContract(ctx(req), (req.params as any).contractId));

  // Avenants
  app.post("/api/v1/contracts/:contractId/amendments", async (req, reply) => { reply.code(201); return svc.createAmendment(ctx(req), (req.params as any).contractId, req.body as any); });
  app.get("/api/v1/contracts/:contractId/amendments", async (req) => svc.listAmendments(ctx(req), (req.params as any).contractId));
  app.post("/api/v1/amendments/:id/sign", async (req) => svc.signAmendment(ctx(req), (req.params as any).id));

  // D2b — Coordonnées bancaires (masquées par défaut ; IBAN complet audité)
  app.post("/api/v1/persons/:personId/bank-accounts", async (req, reply) => { reply.code(201); return sensitiveSvc.registerBankAccount(ctx(req), (req.params as any).personId, req.body as any); });
  app.get("/api/v1/persons/:personId/bank-accounts", async (req) => sensitiveSvc.listBankAccounts(ctx(req), (req.params as any).personId));
  app.get("/api/v1/bank-accounts/:id/iban", async (req) => sensitiveSvc.readIban(ctx(req), (req.params as any).id));
  app.post("/api/v1/bank-accounts/:id/status", async (req) => sensitiveSvc.setBankStatus(ctx(req), (req.params as any).id, (req.body as any)?.status));
  // D2b — Identifiants sensibles (NIR chiffré ; lecture auditée)
  app.post("/api/v1/persons/:personId/sensitive-ids", async (req, reply) => { reply.code(201); return sensitiveSvc.registerSensitiveId(ctx(req), (req.params as any).personId, req.body as any); });
  app.get("/api/v1/sensitive-ids/:id/value", async (req) => sensitiveSvc.readSensitiveValue(ctx(req), (req.params as any).id));
  // D2b — Adresses historisées (SCD-2)
  app.post("/api/v1/persons/:personId/addresses", async (req, reply) => { reply.code(201); return sensitiveSvc.registerAddress(ctx(req), (req.params as any).personId, req.body as any); });
  app.get("/api/v1/persons/:personId/addresses", async (req) => sensitiveSvc.listAddresses(ctx(req), (req.params as any).personId));
  // D2b — Demandes de changement self-service
  app.post("/api/v1/me/change-requests", async (req, reply) => { reply.code(201); return sensitiveSvc.submitChangeRequest(ctx(req), req.body as any); });
  app.get("/api/v1/me/change-requests", async (req) => sensitiveSvc.listMyChangeRequests(ctx(req)));
  app.get("/api/v1/change-requests/pending", async (req) => sensitiveSvc.listPendingChangeRequests(ctx(req)));
  app.post("/api/v1/change-requests/:id/approve", async (req) => sensitiveSvc.decideChangeRequest(ctx(req), (req.params as any).id, true));
  app.post("/api/v1/change-requests/:id/refuse", async (req) => sensitiveSvc.decideChangeRequest(ctx(req), (req.params as any).id, false, (req.body as any)?.reason));
  // Journal d'audit (lecture restreinte)
  app.get("/api/v1/audit", async (req) => sensitiveSvc.listAudit(ctx(req)));

  // Organigramme
  app.get("/api/v1/companies/:companyId/org-chart", async (req) => orgSvc.chart(ctx(req), (req.params as any).companyId));

  // D4 — Préparation des variables de paie (calcul délégué au partenaire, ADR-008)
  app.get("/api/v1/employments/:employmentId/payroll-input", async (req) => {
    const q = req.query as any;
    return svc.preparePayrollInput(ctx(req), (req.params as any).employmentId, { year: Number(q.year), month: Number(q.month) });
  });
  app.get("/api/v1/companies/:companyId/payroll-batch", async (req) => {
    const q = req.query as any;
    return svc.preparePayrollBatch(ctx(req), (req.params as any).companyId, { year: Number(q.year), month: Number(q.month) });
  });

  // D10 — Coffre-fort documentaire
  app.post("/api/v1/persons/:personId/documents", async (req, reply) => {
    reply.code(201); return mvp.depositDocument(ctx(req), { personId: (req.params as any).personId, ...(req.body as any) });
  });
  app.get("/api/v1/persons/:personId/documents", async (req) => mvp.listDocuments(ctx(req), (req.params as any).personId));
  app.post("/api/v1/documents/:id/verify", async (req) => mvp.verifyIntegrity(ctx(req), (req.params as any).id, (req.body as any)?.content ?? ""));
  // Lot 19 — téléchargement du contenu (droits + intégrité recalculée + journalisation).
  app.get("/api/v1/documents/:id/download", async (req, reply) => {
    const out = await mvp.downloadDocument(ctx(req), (req.params as any).id);
    reply.header("content-type", out.contentType);
    reply.header("content-disposition", `attachment; filename="${out.filename.replace(/[\r\n"]/g, "")}"`);
    return reply.send(out.bytes);
  });
  app.post("/api/v1/documents/:id/signature/request", async (req) => mvp.requestSignature(ctx(req), (req.params as any).id, req.body as any));
  app.post("/api/v1/documents/:id/signature/sign", async (req) => mvp.signDocument(ctx(req), (req.params as any).id, req.body as any));
  // Cycle de vie documentaire
  app.post("/api/v1/documents/:id/validate", async (req) => mvp.validateDocument(ctx(req), (req.params as any).id));
  app.post("/api/v1/documents/:id/publish", async (req) => mvp.publishDocument(ctx(req), (req.params as any).id));
  app.post("/api/v1/documents/:id/archive", async (req) => mvp.archiveDocument(ctx(req), (req.params as any).id));
  // Legal hold + suppression contrôlée (DELETE ≠ ANONYMIZE ≠ ARCHIVE)
  app.post("/api/v1/documents/:id/legal-hold", async (req) => mvp.setLegalHold(ctx(req), (req.params as any).id, (req.body as any)?.hold !== false));
  app.post("/api/v1/documents/:id/anonymize", async (req) => mvp.anonymizeDocument(ctx(req), (req.params as any).id));
  app.delete("/api/v1/documents/:id", async (req) => mvp.deleteDocument(ctx(req), (req.params as any).id));
  // Génération par template (contrôle des données requises)
  app.post("/api/v1/documents/generate", async (req, reply) => { reply.code(201); return mvp.generateFromTemplate(ctx(req), req.body as any); });

  // D3 — Temps & congés
  app.post("/api/v1/employments/:employmentId/leave-requests", async (req, reply) => {
    reply.code(201); return mvp.requestLeave(ctx(req), (req.params as any).employmentId, req.body as any);
  });
  // D3 — Planning & pointage
  app.post("/api/v1/employments/:employmentId/shifts", async (req, reply) => { reply.code(201); return timeSvc.planShift(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.post("/api/v1/employments/:employmentId/time-entries", async (req, reply) => { reply.code(201); return timeSvc.recordTime(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.get("/api/v1/employments/:employmentId/time-summary", async (req) => {
    const q = req.query as any;
    return timeSvc.timeSummary(ctx(req), (req.params as any).employmentId, Number(q.year), Number(q.month));
  });

  app.post("/api/v1/leave-requests/:id/approve", async (req) => mvp.approveLeave(ctx(req), (req.params as any).id));
  app.post("/api/v1/leave-requests/:id/hr-approve", async (req) => mvp.approveLeaveHr(ctx(req), (req.params as any).id));
  app.post("/api/v1/leave-requests/:id/refuse", async (req) => mvp.refuseLeave(ctx(req), (req.params as any).id));
  app.post("/api/v1/employments/:employmentId/leave-corrections", async (req, reply) => { reply.code(201); return mvp.correctLeaveBalance(ctx(req), (req.params as any).employmentId, req.body as any); });
  app.get("/api/v1/employments/:employmentId/leave-balance", async (req) =>
    mvp.leaveBalance(ctx(req), (req.params as any).employmentId, (req.query as any).type ?? "PAID", (req.query as any).asOf));

  // Exposé pour l'inspection dans les tests
  (app as any).bus = bus;
  (app as any).db = repo; // MemoryRepository expose ses tableaux pour l'inspection en test
  return app;
}
