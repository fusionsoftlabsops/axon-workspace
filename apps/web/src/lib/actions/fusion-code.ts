'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { generateApiToken } from '@/lib/api-auth';
import { assertProjectMember } from '@/lib/auth/membership';
import { env } from '@/lib/env';
import type { ActionResult } from './projects';

export interface ProjectAgentSetup {
  /** Plain `ad_pk_` token — shown ONCE. Goes in ~/.qwen/.env as AXON_API_TOKEN. */
  plainToken: string;
  /** Public Axon MCP URL the `axon` MCP server points at. */
  mcpUrl: string;
  /** The project slug for `.axon/config.json`. */
  projectSlug: string;
}

// Scopes a Fusion Code / Qwen agent needs to work a project's HUs end to end:
// read tasks + update status, comment, and read/write the brain (recall + /sync).
const AGENT_SCOPES = ['tasks:read', 'tasks:write', 'comments:write', 'brain:read', 'brain:write'];

/**
 * Mint a project-scoped `ad_pk_` API token for Fusion Code (the Qwen editor) so
 * `/task` and `/sync` work against this project. Reuses the same token mechanism
 * as `createApiTokenAction`, but pre-scoped to this project and this purpose. The
 * plain token is returned once (never retrievable again).
 */
export async function createProjectAgentTokenAction(
  slug: string,
): Promise<ActionResult<ProjectAgentSetup>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;
  if (ctx.role === 'VIEWER') return { ok: false, error: 'Sin permisos para generar el token' };

  const { plain, hash, prefix } = generateApiToken();
  const created = await prisma.apiToken.create({
    data: {
      userId,
      name: `Fusion Code – ${slug}`,
      tokenHash: hash,
      prefix,
      scopes: AGENT_SCOPES,
      projectSlugs: [slug],
    },
  });

  await audit({
    actorId: userId,
    action: 'api_token.create',
    resourceType: 'api_token',
    resourceId: created.id,
    projectId: ctx.projectId,
    payload: { name: created.name, scopes: AGENT_SCOPES, via: 'fusion-code' },
  });

  return {
    ok: true,
    data: { plainToken: plain, mcpUrl: env().AXON_MCP_URL, projectSlug: slug },
  };
}
