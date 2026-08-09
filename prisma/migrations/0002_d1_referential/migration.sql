-- Rhéos — Lot 2 (D1 Entreprise & Référentiel).
-- Migration additive : aucune donnée écrasée, aucune suppression de colonne.

-- 1) Obligation : état terminal ARCHIVED (le cycle DETECTED→…→ARCHIVED ; jamais de DELETE).
ALTER TYPE "ObligationStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- Rappel : après migration, réappliquer la RLS pour couvrir les tables de ce lot
--   (Agreement, WorkforceSnapshot sont déjà dans la liste RLS de 0001_init/rls.sql).
-- Les colonnes Establishment.closureDate / validFrom / validTo existent déjà au schéma cible.
