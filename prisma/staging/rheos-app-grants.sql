-- Rhéos — Privilèges MINIMAUX du rôle applicatif rheos_app (Lot 15).
-- Exécuté par l'utilisateur ADMIN (migrations/DDL). rheos_app ne fait que du DML,
-- jamais de DDL, n'est pas superutilisateur et ne contourne pas la RLS.
-- Idempotent : à rejouer sans risque (rheos_app est pré-créé côté Scaleway).

-- 1) Attributs de sécurité : NI superuser, NI bypass RLS, NI création.
ALTER ROLE rheos_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;

-- 2) Connexion + usage du schéma (pas de CREATE → pas de DDL).
GRANT CONNECT ON DATABASE rheos TO rheos_app;
GRANT USAGE ON SCHEMA public TO rheos_app;
REVOKE CREATE ON SCHEMA public FROM rheos_app;   -- interdit explicitement le DDL

-- 3) DML sur les tables existantes + à venir (migrations créées par l'admin).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rheos_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rheos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rheos_app;
ALTER DEFAULT PRIVILEGES FOR ROLE CURRENT_USER IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rheos_app;

-- 4) set_config('app.tenant_id', ...) est public (aucun GRANT requis).
--    L'app pose SET LOCAL par transaction (RLS). Le rôle ne doit PAS bypasser la RLS
--    (vérifié par ALTER ... NOBYPASSRLS ci-dessus et par le test automatisé).

-- Contrôle rapide (à exécuter en admin) :
--   SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
--   FROM pg_roles WHERE rolname='rheos_app';
--   → attendu : f | f | f | f
