-- Two-step file context: a generated, downloadable AI-cleaned markdown artifact
-- (contextMarkdown) tracked by contextStatus, separate from the "use in plan"
-- decision (isContext). extractedText stays as the raw 0-token extraction cache.
ALTER TABLE "ProjectFile" ADD COLUMN "contextStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ProjectFile" ADD COLUMN "contextMarkdown" TEXT;
ALTER TABLE "ProjectFile" ADD COLUMN "contextError" TEXT;
