-- Rhéos — Lot 5 (Socle Temps : absences, congés, compteurs). Migration additive.
ALTER TYPE "LeaveType"   ADD VALUE IF NOT EXISTS 'FAMILY_EVENT';
ALTER TYPE "LeaveStatus" ADD VALUE IF NOT EXISTS 'MANAGER_APPROVED';

CREATE TYPE "LeaveLedgerKind" AS ENUM ('ACCRUAL','TAKEN','CORRECTION','CARRYOVER','RESET');

ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "managerApprovedBy" TEXT;

-- Grand livre append-only des congés.
CREATE TABLE IF NOT EXISTS "LeaveLedgerEntry" (
  "id"            TEXT PRIMARY KEY,
  "tenantId"      TEXT NOT NULL,
  "employmentId"  TEXT NOT NULL,
  "type"          "LeaveType" NOT NULL,
  "kind"          "LeaveLedgerKind" NOT NULL,
  "days"          INTEGER NOT NULL,
  "effectiveDate" TIMESTAMP NOT NULL,
  "sourceRef"     TEXT,
  "reason"        TEXT,
  "createdBy"     TEXT,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "LeaveLedgerEntry_tenant_emp_type_date"
  ON "LeaveLedgerEntry" ("tenantId","employmentId","type","effectiveDate");

-- RLS : ajouter LeaveLedgerEntry à la liste des tables protégées (voir rls.sql).
ALTER TABLE "LeaveLedgerEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LeaveLedgerEntry" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "LeaveLedgerEntry"
  USING ("tenantId" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
