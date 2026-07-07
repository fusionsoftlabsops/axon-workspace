-- Migración a login SOLO-SSO (OIDC / Authentik). Se elimina TODO el login local:
--   * passwordHash: la contraseña local ya no existe (alta y auth las gestiona el IdP).
--   * totpSecretEncrypted / totpNonce: el 2FA lo maneja ahora Authentik.
--   * PasswordResetToken: el reset de contraseña local desaparece con el login local.
--
-- NO se tocan las columnas del vault E2E (publicKey, encryptedPrivateKey,
-- encryptedPrivKeyNonce, kdfSalt, recovery*), que son independientes del login.
ALTER TABLE "User" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "User" DROP COLUMN IF EXISTS "totpSecretEncrypted";
ALTER TABLE "User" DROP COLUMN IF EXISTS "totpNonce";

DROP TABLE IF EXISTS "PasswordResetToken";
