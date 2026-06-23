import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getServerT } from '@/lib/i18n/server';
import { TokensPanel } from './TokensPanel';

export default async function TokensPage() {
  const t = await getServerT();
  const session = await auth();
  if (!session?.user?.id) return null;

  const [tokens, projects] = await Promise.all([
    prisma.apiToken.findMany({
      where: { userId: session.user.id, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        prefix: true,
        scopes: true,
        projectSlugs: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId: session.user.id } } },
      select: { slug: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <div style={{ maxWidth: '900px', padding: '2rem 1.5rem' }}>
      <h1>{t('API tokens', 'API tokens')}</h1>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        {t(
          'Tokens para el MCP server de Claude Code u otros clientes programáticos. Limita scopes y proyectos por token.',
          'Tokens for the Claude Code MCP server or other programmatic clients. Limit scopes and projects per token.',
        )}
      </p>
      <TokensPanel
        tokens={tokens.map((tok) => ({
          ...tok,
          lastUsedAt: tok.lastUsedAt?.toISOString() ?? null,
          expiresAt: tok.expiresAt?.toISOString() ?? null,
          createdAt: tok.createdAt.toISOString(),
        }))}
        availableProjects={projects}
      />
    </div>
  );
}
