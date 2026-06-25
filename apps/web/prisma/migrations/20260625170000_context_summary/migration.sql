-- CreateEnum
CREATE TYPE "ContextScope" AS ENUM ('PROJECT', 'TASK');

-- CreateTable
CREATE TABLE "ContextSummary" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" "ContextScope" NOT NULL,
    "refId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "signature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContextSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContextSummary_scope_refId_key" ON "ContextSummary"("scope", "refId");

-- CreateIndex
CREATE INDEX "ContextSummary_projectId_scope_idx" ON "ContextSummary"("projectId", "scope");

-- AddForeignKey
ALTER TABLE "ContextSummary" ADD CONSTRAINT "ContextSummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
