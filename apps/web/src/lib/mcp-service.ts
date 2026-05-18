/**
 * Helper to keep the MCP service user (mcp-service@admin-data.local) as a
 * silent MEMBER of every project, so the Claude Code MCP server can see
 * tasks across all projects without manual invitations.
 *
 * The service user is created by `scripts/bootstrap-mcp-token.mjs`; if it
 * doesn't exist yet (e.g. someone hasn't set up the MCP integration), this
 * is a no-op — we never want project creation to fail just because the MCP
 * isn't configured.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export const MCP_SERVICE_EMAIL = 'mcp-service@admin-data.local';

type Tx = PrismaClient | Prisma.TransactionClient;

/**
 * Idempotently add the MCP service user as a MEMBER of `projectId`.
 * Returns `true` if the user exists and the membership is now present,
 * `false` if there's no MCP service user configured.
 */
export async function ensureMcpServiceMembership(tx: Tx, projectId: string): Promise<boolean> {
  const service = await tx.user.findUnique({
    where: { email: MCP_SERVICE_EMAIL },
    select: { id: true },
  });
  if (!service) return false;

  await tx.projectMember.upsert({
    where: { projectId_userId: { projectId, userId: service.id } },
    update: {}, // never demote / promote an existing membership
    create: { projectId, userId: service.id, role: 'MEMBER' },
  });
  return true;
}
