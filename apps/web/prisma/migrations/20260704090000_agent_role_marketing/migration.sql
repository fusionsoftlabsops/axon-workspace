-- Agente Branding/SEO/Marketing (Sol): 8º rol + kit de marketing en la HU.
ALTER TYPE "AgentRole" ADD VALUE IF NOT EXISTS 'MARKETING';

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "marketingKit" TEXT;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "marketingKitAt" TIMESTAMP(3);
