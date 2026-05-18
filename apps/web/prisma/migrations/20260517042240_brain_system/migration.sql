-- CreateEnum
CREATE TYPE "BrainScope" AS ENUM ('LOCAL', 'PROJECT');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('DECISION', 'GOTCHA', 'PATTERN', 'ANTIPATTERN', 'RUNBOOK', 'GLOSSARY', 'NOTE');

-- CreateEnum
CREATE TYPE "MemoryStatus" AS ENUM ('ACTIVE', 'DEPRECATED', 'SUPERSEDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskActivityType" ADD VALUE 'MEMORY_CITED';
ALTER TYPE "TaskActivityType" ADD VALUE 'MEMORY_CAPTURED';

-- CreateTable
CREATE TABLE "BrainMemory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "scope" "BrainScope" NOT NULL,
    "ownerUserId" TEXT,
    "authorId" TEXT NOT NULL,
    "type" "MemoryType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[],
    "sourceTaskId" TEXT,
    "status" "MemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "supersededById" TEXT,
    "lastCitedAt" TIMESTAMP(3),
    "citationCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrainMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCitation" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "citedInTaskId" TEXT NOT NULL,
    "citedByUserId" TEXT NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrainSyncState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "lastPulledAt" TIMESTAMP(3),

    CONSTRAINT "BrainSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrainMemory_projectId_scope_status_idx" ON "BrainMemory"("projectId", "scope", "status");

-- CreateIndex
CREATE INDEX "BrainMemory_ownerUserId_scope_idx" ON "BrainMemory"("ownerUserId", "scope");

-- CreateIndex
CREATE INDEX "BrainMemory_sourceTaskId_idx" ON "BrainMemory"("sourceTaskId");

-- CreateIndex
CREATE INDEX "MemoryCitation_memoryId_createdAt_idx" ON "MemoryCitation"("memoryId", "createdAt");

-- CreateIndex
CREATE INDEX "MemoryCitation_citedInTaskId_idx" ON "MemoryCitation"("citedInTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "BrainSyncState_userId_projectId_key" ON "BrainSyncState"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "BrainMemory" ADD CONSTRAINT "BrainMemory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainMemory" ADD CONSTRAINT "BrainMemory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainMemory" ADD CONSTRAINT "BrainMemory_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainMemory" ADD CONSTRAINT "BrainMemory_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainMemory" ADD CONSTRAINT "BrainMemory_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "BrainMemory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCitation" ADD CONSTRAINT "MemoryCitation_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "BrainMemory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCitation" ADD CONSTRAINT "MemoryCitation_citedInTaskId_fkey" FOREIGN KEY ("citedInTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCitation" ADD CONSTRAINT "MemoryCitation_citedByUserId_fkey" FOREIGN KEY ("citedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainSyncState" ADD CONSTRAINT "BrainSyncState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrainSyncState" ADD CONSTRAINT "BrainSyncState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================
-- Full-text search column + trigger (Prisma cannot express tsvector natively)
-- ============================================================

ALTER TABLE "BrainMemory" ADD COLUMN "search_vector" tsvector;

CREATE INDEX "BrainMemory_search_vector_idx" ON "BrainMemory" USING GIN ("search_vector");

CREATE OR REPLACE FUNCTION brain_memory_search_update() RETURNS trigger AS $$
BEGIN
  NEW."search_vector" :=
    setweight(to_tsvector('spanish', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('spanish', coalesce(NEW.body, '')), 'B') ||
    setweight(
      to_tsvector(
        'spanish',
        array_to_string(coalesce(NEW.tags, ARRAY[]::text[]), ' ')
      ),
      'C'
    );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER brain_memory_search_trigger
  BEFORE INSERT OR UPDATE OF title, body, tags ON "BrainMemory"
  FOR EACH ROW EXECUTE FUNCTION brain_memory_search_update();
