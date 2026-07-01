-- QA workflow fields on Task: developer→QA handoff and QA-authored tests.
ALTER TABLE "Task" ADD COLUMN "qaHandoff" JSONB;
ALTER TABLE "Task" ADD COLUMN "qaTests" JSONB;
