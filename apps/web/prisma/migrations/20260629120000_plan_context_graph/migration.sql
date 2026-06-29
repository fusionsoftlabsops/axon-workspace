-- Lets the user choose which graph grounds a plan (code knowledge graph vs none).
-- NULL keeps the existing "auto" behavior (use the code graph when READY).
ALTER TABLE "ProjectPlan" ADD COLUMN "contextGraph" TEXT;
