-- AlterTable
ALTER TABLE "User" ADD COLUMN     "encryptedPrivKeyRecovery" BYTEA,
ADD COLUMN     "recoveryKdfSalt" BYTEA,
ADD COLUMN     "recoveryPrivKeyNonce" BYTEA;
