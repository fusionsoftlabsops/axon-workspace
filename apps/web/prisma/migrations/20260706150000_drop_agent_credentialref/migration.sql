-- Drop de la columna inerte `credentialRef` del modelo Agent. Ya no la consume
-- nada en runtime: la selección de provider LLM es por `llmModel` (ver Fase 4
-- del plan de mejora). Toda la superficie de código/tipos se removió en #84.
ALTER TABLE "Agent" DROP COLUMN IF EXISTS "credentialRef";
