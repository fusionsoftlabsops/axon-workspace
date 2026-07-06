-- Runtime de agentes por proyecto: CLOUD (worker 24/7) | LOCAL (Claude Code del usuario).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "agentRuntime" TEXT NOT NULL DEFAULT 'CLOUD';
