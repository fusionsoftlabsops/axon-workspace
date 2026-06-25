-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('IMAGE', 'DOCUMENT', 'LINK');

-- CreateTable
CREATE TABLE "PlanAttachment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" INTEGER,
    "storageKey" TEXT,
    "url" TEXT,
    "extractedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanAttachment_planId_idx" ON "PlanAttachment"("planId");

-- AddForeignKey
ALTER TABLE "PlanAttachment" ADD CONSTRAINT "PlanAttachment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProjectPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
