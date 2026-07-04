-- Ejecutor de desarrollo por proyecto (modo hibrido consola/agente).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "devExecutor" TEXT NOT NULL DEFAULT 'KAI';
