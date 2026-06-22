-- AlterTable
ALTER TABLE "Credential" ADD COLUMN     "needsRotation" BOOLEAN NOT NULL DEFAULT false;
