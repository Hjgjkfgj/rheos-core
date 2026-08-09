-- Rhéos — Lot 3 (D2 Dossier collaborateur). Migration additive.
-- Employment : état terminal ARCHIVED (cycle EXITING→ENDED→ARCHIVED ; jamais de DELETE ;
-- une réembauche = un NOUVEL Employment, jamais un doublon de Person).
ALTER TYPE "EmploymentStatus" ADD VALUE IF NOT EXISTS 'ARCHIVED';
