-- Lot 11 — RLS sur ChangeRequest (créé par `prisma db push`).
ALTER TABLE "ChangeRequest" ENABLE ROW LEVEL SECURITY;
-- NO FORCE (cf. 0001) : rheos_app isolé ; owner/admin contourne pour pg_dump/restore.
ALTER TABLE "ChangeRequest" NO FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChangeRequest";
CREATE POLICY tenant_isolation ON "ChangeRequest"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
