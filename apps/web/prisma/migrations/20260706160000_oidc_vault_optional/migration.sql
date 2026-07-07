-- Desacople del vault E2E para usuarios federados (SSO/OIDC): un usuario SSO no
-- tiene contraseña local ni material de vault derivado de una passphrase, así
-- que estos campos dejan de ser obligatorios. Los usuarios locales existentes
-- ya los tienen poblados; esta migración no los toca (solo relaja el NOT NULL).
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "publicKey" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "encryptedPrivateKey" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "encryptedPrivKeyNonce" DROP NOT NULL;
ALTER TABLE "User" ALTER COLUMN "kdfSalt" DROP NOT NULL;
