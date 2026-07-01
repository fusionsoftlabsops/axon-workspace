-- Optional seniority captured at invite time (carried onto ProjectMember on join).
ALTER TABLE "Invitation" ADD COLUMN "seniority" "Seniority";

-- Live plan-generation progress + heartbeat (for progress UI and orphan detection).
ALTER TABLE "ProjectPlan" ADD COLUMN "stats" JSONB;
ALTER TABLE "ProjectPlan" ADD COLUMN "heartbeatAt" TIMESTAMP(3);

-- Login-password reset tokens (separate from the E2E vault).
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
