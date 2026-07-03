-- Fase 2: chat del equipo (standup permanente agentes+humanos) y nombre propio
-- por agente. Aditiva y reversible: solo CREATE/ADD COLUMN nullable.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN "displayName" TEXT;

-- CreateEnum
CREATE TYPE "TeamMessageKind" AS ENUM ('CHAT', 'STATUS', 'HANDOFF');

-- CreateTable
CREATE TABLE "TeamChatMessage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "agentRole" "AgentRole",
    "authorName" TEXT NOT NULL,
    "kind" "TeamMessageKind" NOT NULL DEFAULT 'CHAT',
    "body" TEXT NOT NULL,
    "storyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamChatMessage_projectId_createdAt_idx" ON "TeamChatMessage"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamChatMessage" ADD CONSTRAINT "TeamChatMessage_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
