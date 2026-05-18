-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('TASK', 'STORY', 'EPIC', 'BUG', 'SPIKE');

-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('ANTHROPIC', 'OPENAI', 'GOOGLE', 'MOONSHOT');

-- CreateEnum
CREATE TYPE "StoryDraftStatus" AS ENUM ('GENERATING', 'READY', 'ERRORED', 'PUBLISHED');

-- DropIndex
DROP INDEX "BrainMemory_search_vector_idx";

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "repoDefaultBranch" TEXT DEFAULT 'main',
ADD COLUMN     "repoPath" TEXT,
ADD COLUMN     "repoUrl" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "kind" "TaskKind" NOT NULL DEFAULT 'TASK';

-- CreateTable
CREATE TABLE "LlmCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "provider" "LlmProvider" NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedKey" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "modelDefault" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "LlmCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryDraft" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "parentDraftId" TEXT,
    "taskId" TEXT,
    "rawInput" TEXT NOT NULL,
    "provider" "LlmProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "selectedPaths" TEXT[],
    "citedMemoryIds" TEXT[],
    "summary" TEXT,
    "acceptanceCriteria" TEXT,
    "technicalContext" TEXT,
    "subtaskBreakdown" JSONB,
    "filesToTouch" JSONB,
    "risks" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "status" "StoryDraftStatus" NOT NULL DEFAULT 'GENERATING',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoryDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LlmCredential_userId_provider_idx" ON "LlmCredential"("userId", "provider");

-- CreateIndex
CREATE INDEX "LlmCredential_projectId_provider_idx" ON "LlmCredential"("projectId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "StoryDraft_taskId_key" ON "StoryDraft"("taskId");

-- CreateIndex
CREATE INDEX "StoryDraft_projectId_createdAt_idx" ON "StoryDraft"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "StoryDraft_authorId_createdAt_idx" ON "StoryDraft"("authorId", "createdAt");

-- AddForeignKey
ALTER TABLE "LlmCredential" ADD CONSTRAINT "LlmCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmCredential" ADD CONSTRAINT "LlmCredential_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryDraft" ADD CONSTRAINT "StoryDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryDraft" ADD CONSTRAINT "StoryDraft_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryDraft" ADD CONSTRAINT "StoryDraft_parentDraftId_fkey" FOREIGN KEY ("parentDraftId") REFERENCES "StoryDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryDraft" ADD CONSTRAINT "StoryDraft_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Restaurar el GIN index del search_vector del cerebro (dropeado al
-- introducir la columna Unsupported("tsvector") en el schema Prisma).
-- El trigger brain_memory_search_trigger sigue activo desde la migración
-- 20260517042240_brain_system.
CREATE INDEX IF NOT EXISTS "BrainMemory_search_vector_idx"
  ON "BrainMemory" USING GIN ("search_vector");
