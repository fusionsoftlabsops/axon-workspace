-- Plataforma agéntica (Fase 1): identidad de agentes (Agent) y bitácora de
-- corridas (AgentRun). Aditiva y reversible: solo CREATE, sin tocar datos.

-- CreateEnum
CREATE TYPE "AgentRole" AS ENUM ('SM', 'DEV', 'QA');
CREATE TYPE "AgentRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'BUDGET_EXCEEDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL,
    "userId" TEXT NOT NULL,
    "apiTokenId" TEXT,
    "llmModel" TEXT NOT NULL,
    "credentialRef" TEXT,
    "tokenBudget" INTEGER NOT NULL DEFAULT 200000,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "storyId" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "error" TEXT,
    "payload" JSONB,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_apiTokenId_key" ON "Agent"("apiTokenId");
CREATE UNIQUE INDEX "Agent_projectId_role_key" ON "Agent"("projectId", "role");
CREATE INDEX "Agent_userId_idx" ON "Agent"("userId");
CREATE INDEX "AgentRun_agentId_startedAt_idx" ON "AgentRun"("agentId", "startedAt");
CREATE INDEX "AgentRun_storyId_idx" ON "AgentRun"("storyId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_apiTokenId_fkey" FOREIGN KEY ("apiTokenId") REFERENCES "ApiToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
