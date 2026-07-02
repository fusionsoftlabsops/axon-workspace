'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { audit } from '@/lib/audit';
import { generateApiToken } from '@/lib/api-auth';
import { assertProjectMember } from '@/lib/auth/membership';
import { env } from '@/lib/env';
import {
  createModelToken,
  getExposedModels,
  isFusionConfigured,
} from '@/lib/deploy/fusion-coding-tools';
import type { ActionResult } from './projects';

export interface ProjectAgentSetup {
  /** Plain `ad_pk_` token — shown ONCE. Goes in ~/.qwen/.env as AXON_API_TOKEN. */
  plainToken: string;
  /** Public Axon MCP URL the `axon` MCP server points at. */
  mcpUrl: string;
  /** The project slug for `.axon/config.json`. */
  projectSlug: string;
}

export interface ModelSetup {
  /** Public OpenAI-compatible model base, /v1 included — what the installer expects. */
  modelUrl: string;
  /** Plain `fsn_` model token — shown ONCE, revocable from Coding Tools. */
  token: string;
}

// Scopes a Fusion Code / Qwen agent needs to work a project's HUs end to end:
// read tasks + update status, comment, read/write the brain (recall + /sync), and
// read/contribute the shared skills package (/skills sync + submit_skill).
const AGENT_SCOPES = [
  'tasks:read',
  'tasks:write',
  'comments:write',
  'brain:read',
  'brain:write',
  'skills:read',
  'skills:write',
];

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

/**
 * Mint a personal `fsn_` model token on fusion-infra and return it with the
 * public model URL, so the Develop page can render an installer one-liner that
 * needs zero manual steps (the install scripts consume FUSION_MODEL_URL /
 * FUSION_TOKEN and skip every prompt). Any project member can generate one —
 * the token only grants model usage, not Axon writes. The plaintext is
 * returned once; ops can revoke it from the Coding Tools page.
 */
export async function createModelSetupAction(slug: string): Promise<ActionResult<ModelSetup>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: 'No autenticado' };

  const ctx = await assertProjectMember(slug);
  if (!ctx.ok) return ctx;

  if (!isFusionConfigured()) {
    return {
      ok: false,
      error:
        'La instalación asistida no está configurada (FUSION_INFRA_URL / FUSION_INFRA_TOKEN); usá el paso manual de abajo.',
    };
  }

  try {
    const models = await getExposedModels();
    const model = models[0];
    if (!model) {
      return {
        ok: false,
        error: 'No hay ningún modelo expuesto en la plataforma todavía; avisale al administrador.',
      };
    }

    const who = session.user?.name || session.user?.email || userId;
    const minted = await createModelToken(model.appId, `Fusion Code – ${who} – axon/${slug}`);

    await audit({
      actorId: userId,
      action: 'model_token.create',
      resourceType: 'model_token',
      resourceId: minted.id,
      projectId: ctx.projectId,
      payload: { name: minted.name, appId: model.appId, via: 'develop-page' },
    });

    return { ok: true, data: { modelUrl: `${model.url}/v1`, token: minted.token } };
  } catch (e) {
    return {
      ok: false,
      error: `No se pudo generar el token del modelo: ${e instanceof Error ? e.message : 'error desconocido'}`,
    };
  }
}
