-- CreateEnum
CREATE TYPE "Seniority" AS ENUM ('JUNIOR', 'SEMI_SENIOR', 'SENIOR');

-- AlterTable
ALTER TABLE "ProjectMember" ADD COLUMN "seniority" "Seniority";
