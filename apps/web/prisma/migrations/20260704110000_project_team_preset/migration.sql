-- Preset de equipo agéntico activo por proyecto (informativo).
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "teamPreset" TEXT;
