-- Rhéos — Lot 10 : Row-Level Security COMPLÈTE (toutes les tables tenant).
-- Idempotent (DROP POLICY IF EXISTS + CREATE). À appliquer avec le rôle owner.
-- set_config('app.tenant_id', ..., true) est posé par transaction côté app.
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY['Group', 'LegalEntity', 'Establishment', 'OperatingSite', 'OrgUnit', 'Position', 'Agreement', 'WorkforceSnapshot', 'Obligation', 'Person', 'Employment', 'Contract', 'ContractAmendment', 'Assignment', 'Address', 'BankAccount', 'EmergencyContact', 'SensitiveIdentifier', 'Document', 'HrEvent', 'User', 'AiAuditLog', 'AuditLog', 'DomainEvent', 'LeaveRequest', 'LeaveLedgerEntry', 'Budget', 'Competency', 'Training', 'CareerReview', 'Risk', 'WorkAccident', 'AuthorityInteraction', 'CseMandate', 'Negotiation', 'CseMeeting', 'Deadline', 'Shift', 'TimeEntry'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    -- NO FORCE (cf. 0001) : rheos_app reste isolé ; l'owner/admin contourne la RLS par
    -- la propriété, ce qui rend possibles pg_dump/pg_restore (aucun superuser sur Scaleway).
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_setting('app.tenant_id', true))
        WITH CHECK ("tenantId" = current_setting('app.tenant_id', true));
    $p$, t);
  END LOOP;
END $$;
