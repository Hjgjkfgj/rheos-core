-- Rhéos — Lot 7 (IA cadrée). Journal des interactions IA (append-only).
CREATE TABLE IF NOT EXISTS "AiAuditLog" (
  "id"       TEXT PRIMARY KEY,
  "tenantId" TEXT NOT NULL,
  "userId"   TEXT,
  "kind"     TEXT NOT NULL,
  "query"    TEXT,
  "dataUsed" TEXT[] NOT NULL DEFAULT '{}',
  "version"  TEXT NOT NULL,
  "outcome"  TEXT NOT NULL,
  "at"       TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "AiAuditLog_tenant_at" ON "AiAuditLog" ("tenantId","at");
ALTER TABLE "AiAuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiAuditLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "AiAuditLog"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
