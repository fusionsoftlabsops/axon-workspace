-- Per-user chat bubble colors for the planning chat (shared per project).
ALTER TABLE "ProjectPlan" ADD COLUMN "chatColors" JSONB;
