-- AlterTable
ALTER TABLE "User" ADD COLUMN "githubLogin" TEXT;

-- CreateTable
CREATE TABLE "ProjectRepo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'other',
    "url" TEXT,
    "githubFullName" TEXT,
    "defaultBranch" TEXT DEFAULT 'main',
    "private" BOOLEAN NOT NULL DEFAULT true,
    "repoPath" TEXT,
    "access" JSONB,
    "accessCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectRepo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectRepo_projectId_idx" ON "ProjectRepo"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepo_projectId_name_key" ON "ProjectRepo"("projectId", "name");

-- AddForeignKey
ALTER TABLE "ProjectRepo" ADD CONSTRAINT "ProjectRepo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
