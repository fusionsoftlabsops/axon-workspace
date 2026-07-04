/**
 * Aprovisionamiento de identidad para agentes (Fase 1).
 *
 * Un agente ES un usuario de servicio (uno global por rol: SM/DEV/QA, sin
 * login ni acceso al vault — mismo patrón que el usuario del MCP) que se
 * vuelve MIEMBRO del proyecto y opera con un ApiToken propio acuñado con el
 * flujo existente de api-auth (ad_pk_*, sha256 en DB, scopes + projectSlugs).
 *
 * Esa identidad por token es la base del guardarraíl anti auto-aprobación:
 * la Admin API puede distinguir QUIÉN desarrolló y QUIÉN aprueba.
 */
import type { AgentRole, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/db';
import { generateApiToken } from '@/lib/api-auth';

type Tx = PrismaClient | Prisma.TransactionClient;

export const AGENT_EMAIL_DOMAIN = 'agents.axon.local';

export function agentEmail(role: AgentRole): string {
  return `agent-${role.toLowerCase()}@${AGENT_EMAIL_DOMAIN}`;
}

export const AGENT_DISPLAY_NAMES: Record<AgentRole, string> = {
  SM: 'Agente Scrum Master',
  DEV: 'Agente Dev',
  QA: 'Agente QA',
  PO: 'Agente Product Owner',
  DESIGN: 'Agente Diseño',
  REVIEWER: 'Agente Code Reviewer',
};

/** Scopes mínimos para operar el tablero — sin projects:write ni skills:write. */
export const AGENT_TOKEN_SCOPES = [
  'projects:read',
  'tasks:read',
  'tasks:write',
  'comments:write',
  'brain:read',
  'brain:write',
  'stories:read',
] as const;

// Cuentas de servicio: sin passphrase no puede existir material de llaves real
// (restricción zero-knowledge del vault) — se rellenan los campos con dummies,
// igual que el usuario del MCP. El agente jamás inicia sesión web.
const DUMMY_PUBKEY = Buffer.alloc(32, 0);
const DUMMY_NONCE = Buffer.alloc(24, 0);
const DUMMY_SALT = Buffer.alloc(16, 0);

/** Upsert del usuario de servicio global del rol (idempotente). */
export async function ensureAgentUser(tx: Tx, role: AgentRole): Promise<{ id: string }> {
  return tx.user.upsert({
    where: { email: agentEmail(role) },
    update: {},
    create: {
      email: agentEmail(role),
      name: AGENT_DISPLAY_NAMES[role],
      passwordHash: '$argon2id$disabled$agent-service-account-no-login',
      publicKey: DUMMY_PUBKEY,
      encryptedPrivateKey: Buffer.from(`agent-${role.toLowerCase()}-no-vault-access`),
      encryptedPrivKeyNonce: DUMMY_NONCE,
      kdfSalt: DUMMY_SALT,
    },
    select: { id: true },
  });
}

export interface ProvisionedAgent {
  agentId: string;
  userId: string;
  tokenId: string;
  /** Token plano — se muestra UNA vez y no se persiste. */
  tokenPlain: string;
  tokenPrefix: string;
}

/**
 * Crea la identidad completa de un agente para un proyecto: usuario de
 * servicio del rol + membresía MEMBER + ApiToken scoped al proyecto + fila
 * Agent. Falla si el proyecto ya tiene un agente de ese rol (rotación aparte).
 */
export async function provisionAgent(opts: {
  projectId: string;
  projectSlug: string;
  role: AgentRole;
  llmModel: string;
  credentialRef?: string | null;
  tokenBudget?: number;
}): Promise<ProvisionedAgent> {
  const existing = await prisma.agent.findUnique({
    where: { projectId_role: { projectId: opts.projectId, role: opts.role } },
    select: { id: true },
  });
  if (existing) {
    throw new Error(`El proyecto ya tiene un agente ${opts.role} (rotá su token en vez de crear otro)`);
  }

  const token = generateApiToken();

  const created = await prisma.$transaction(async (tx) => {
    const user = await ensureAgentUser(tx, opts.role);

    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: opts.projectId, userId: user.id } },
      update: {},
      create: { projectId: opts.projectId, userId: user.id, role: 'MEMBER' },
    });

    const apiToken = await tx.apiToken.create({
      data: {
        userId: user.id,
        name: `agent:${opts.role.toLowerCase()}:${opts.projectSlug}`,
        tokenHash: token.hash,
        prefix: token.prefix,
        scopes: [...AGENT_TOKEN_SCOPES],
        projectSlugs: [opts.projectSlug],
      },
      select: { id: true },
    });

    const agent = await tx.agent.create({
      data: {
        projectId: opts.projectId,
        role: opts.role,
        userId: user.id,
        apiTokenId: apiToken.id,
        llmModel: opts.llmModel,
        credentialRef: opts.credentialRef ?? null,
        ...(opts.tokenBudget ? { tokenBudget: opts.tokenBudget } : {}),
      },
      select: { id: true },
    });

    return { agentId: agent.id, userId: user.id, tokenId: apiToken.id };
  });

  return { ...created, tokenPlain: token.plain, tokenPrefix: token.prefix };
}

/**
 * Guardarraíl anti auto-aprobación (de plataforma, no de prompt): un AGENTE no
 * puede mover a Hecho (categoría DONE) una HU que él mismo desarrolló — sea
 * porque entregó el qa-review (qaHandoff.submittedById) o porque es el
 * asignado. Los humanos no se ven afectados.
 *
 * Devuelve el motivo del bloqueo, o null si la transición está permitida.
 */
export async function selfApprovalBlockReason(opts: {
  projectId: string;
  actorUserId: string;
  qaHandoff: unknown;
  assigneeId: string | null;
}): Promise<string | null> {
  const agent = await prisma.agent.findFirst({
    where: { projectId: opts.projectId, userId: opts.actorUserId },
    select: { id: true, role: true },
  });
  if (!agent) return null; // el actor es humano

  const handoff = opts.qaHandoff as { submittedById?: string } | null;
  const developedBy = handoff?.submittedById ?? opts.assigneeId ?? null;
  if (developedBy && developedBy === opts.actorUserId) {
    return `guardrail: el agente ${agent.role} no puede aprobar su propio trabajo (desarrolló esta HU)`;
  }
  return null;
}
