-- Token de agente sellado en reposo para el worker multi-tenant.
CREATE TABLE "AgentRuntimeToken" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" "AgentRole" NOT NULL,
    "sealed" BYTEA NOT NULL,
    "nonce" BYTEA NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentRuntimeToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentRuntimeToken_projectId_role_key" ON "AgentRuntimeToken"("projectId", "role");
CREATE INDEX "AgentRuntimeToken_projectId_idx" ON "AgentRuntimeToken"("projectId");
ALTER TABLE "AgentRuntimeToken" ADD CONSTRAINT "AgentRuntimeToken_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
