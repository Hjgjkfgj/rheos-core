-- Rhéos — Lot 4 (D10 Coffre-fort & documents). Migration additive (WORM : jamais
-- de suppression du coffre ; DELETE contrôlé par rétention échue + absence de legal hold).
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT','REVIEW','VALIDATED','SIGNED','PUBLISHED','ARCHIVED');

ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "category"         TEXT,
  ADD COLUMN IF NOT EXISTS "periodStart"      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "periodEnd"        TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "version"          INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "status"           "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS "retentionTrigger" TEXT,
  ADD COLUMN IF NOT EXISTS "legalHold"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "createdBy"        TEXT,
  ADD COLUMN IF NOT EXISTS "anonymizedAt"     TIMESTAMP;
