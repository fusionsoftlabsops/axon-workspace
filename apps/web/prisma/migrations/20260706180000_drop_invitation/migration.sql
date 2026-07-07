-- Se elimina el sistema de invitaciones PROPIO de Axon (quedó muerto tras pasar
-- a login SOLO-SSO: los enlaces /signup?token= ya no tienen ruta que los reciba).
-- El onboarding + el acceso a proyectos ahora se resuelve por SSO (Authentik) +
-- el mapeo de grupos → membresías (lib/auth/oidc.ts::mapGroupsToMemberships).
--
-- La tabla "Invitation" (con su FK a "User" vía invitedById, ON DELETE CASCADE)
-- se dropea entera. La gestión de miembros existentes (ProjectMember) se conserva.
DROP TABLE IF EXISTS "Invitation";
