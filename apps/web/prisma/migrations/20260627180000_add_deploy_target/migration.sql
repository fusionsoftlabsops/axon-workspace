-- CreateTable
CREATE TABLE "DeployTarget" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fusionTeamId" TEXT NOT NULL,
    "fusionProjectId" TEXT NOT NULL,
    "environmentId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeployTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deployment" (
    "id" TEXT NOT NULL,
    "deployTargetId" TEXT NOT NULL,
    "projectRepoId" TEXT,
    "fusionAppId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'APP',
    "name" TEXT NOT NULL,
    "hostname" TEXT,
    "buildPack" TEXT NOT NULL DEFAULT 'DOCKERFILE',
    "exposedPort" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastDeploymentId" TEXT,
    "error" TEXT,
    "imported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeployTarget_projectId_key" ON "DeployTarget"("projectId");

-- CreateIndex
CREATE INDEX "Deployment_deployTargetId_idx" ON "Deployment"("deployTargetId");

-- CreateIndex
CREATE INDEX "Deployment_projectRepoId_idx" ON "Deployment"("projectRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "Deployment_deployTargetId_fusionAppId_key" ON "Deployment"("deployTargetId", "fusionAppId");

-- AddForeignKey
ALTER TABLE "DeployTarget" ADD CONSTRAINT "DeployTarget_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_deployTargetId_fkey" FOREIGN KEY ("deployTargetId") REFERENCES "DeployTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deployment" ADD CONSTRAINT "Deployment_projectRepoId_fkey" FOREIGN KEY ("projectRepoId") REFERENCES "ProjectRepo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
