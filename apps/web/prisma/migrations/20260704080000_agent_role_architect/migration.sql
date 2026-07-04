-- Agente Arquitecto/Tech Lead (Dax): 7º rol + diseño técnico en la HU.
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'ARCHITECT';

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "techDesign" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "techDesignAt" TIMESTAMP(3);
