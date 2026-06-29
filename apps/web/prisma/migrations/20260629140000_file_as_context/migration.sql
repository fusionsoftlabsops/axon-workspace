-- Mark project files as planning context. Documents cache their extracted text;
-- images contribute as native vision blocks at generation time.
ALTER TABLE "ProjectFile" ADD COLUMN "isContext" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProjectFile" ADD COLUMN "extractedText" TEXT;

-- Quickly find a project's context files when grounding a plan.
CREATE INDEX "ProjectFile_projectId_isContext_idx" ON "ProjectFile" ("projectId", "isContext");
