-- Rhéos — Row-Level Security multi-tenant (ADR-006).
-- À appliquer APRÈS `prisma migrate` (Prisma ne gère pas les policies RLS).
-- Principe : chaque requête applicative ouvre une transaction qui pose
--   SET LOCAL app.tenant_id = '<uuid>';
-- et la policy filtre toutes les lignes sur cette valeur. Défense en profondeur :
-- l'application filtre déjà par tenantId, la base l'impose.

-- Rôle applicatif non-superutilisateur (le superuser CONTOURNE la RLS).
-- CREATE ROLE rheos_app LOGIN PASSWORD '***';
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rheos_app;

-- Fonction helper : tenant courant depuis le paramètre de session.
CREATE OR REPLACE FUNCTION current_tenant() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT current_setting('app.tenant_id', true) $$;

-- Active la RLS + policy sur chaque table portant tenantId ("tenantId" en camelCase).
DO $$
DECLARE t text;
DECLARE tables text[] := ARRAY[
  'Group','LegalEntity','Establishment','OperatingSite','OrgUnit','Position',
  'Agreement','WorkforceSnapshot','Obligation','Person','Employment','Contract',
  'ContractAmendment','Assignment','Address','BankAccount','EmergencyContact',
  'SensitiveIdentifier','Document','HrEvent','LeaveRequest','User','AuditLog','DomainEvent'
];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    -- NO FORCE : le rôle applicatif rheos_app (non-propriétaire) reste soumis à la RLS,
    -- mais le rôle owner/admin (migrations + sauvegardes pg_dump) la contourne par la
    -- propriété. Sur Scaleway, aucun rôle n'est superuser/BYPASSRLS : sans ce NO FORCE,
    -- pg_dump/pg_restore par l'admin échouerait sur les tables RLS.
    EXECUTE format('ALTER TABLE %I NO FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I;', t);   -- idempotent (re-run)
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("tenantId" = current_tenant())
        WITH CHECK ("tenantId" = current_tenant());
    $p$, t);
  END LOOP;
END $$;

-- Exemple d'usage applicatif (middleware, par requête) :
--   BEGIN;
--   SET LOCAL app.tenant_id = 'ACME-uuid';
--   ... requêtes Prisma ...
--   COMMIT;
