-- Plan de implementación por HU: markdown generado por IA (contexto técnico que
-- el agente Dev genera al tomar la HU y usa para implementar). Aditivo y
-- retro-compatible.
ALTER TABLE "Task" ADD COLUMN "implPlan" TEXT;
ALTER TABLE "Task" ADD COLUMN "implPlanAt" TIMESTAMP(3);
