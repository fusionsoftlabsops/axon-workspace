-- Recomendación de configuración de equipo + modo automático.
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "recommendedPreset" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "autoApplyPreset" BOOLEAN NOT NULL DEFAULT true;
