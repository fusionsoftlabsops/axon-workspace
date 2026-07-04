-- Agente Diseño (Aria): 5º rol + spec de diseño en la HU.
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'DESIGN';

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "designSpec" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "designSpecAt" TIMESTAMP(3);
