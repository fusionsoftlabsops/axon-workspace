import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { TokensPanel } from './TokensPanel';

export default async function TokensPage() {
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
      <h1>API tokens</h1>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        Tokens para el MCP server de Claude Code u otros clientes programáticos. Limita scopes y
        proyectos por token.
      </p>
      <TokensPanel
        tokens={tokens.map((t) => ({
          ...t,
          lastUsedAt: t.lastUsedAt?.toISOString() ?? null,
          expiresAt: t.expiresAt?.toISOString() ?? null,
          createdAt: t.createdAt.toISOString(),
        }))}
        availableProjects={projects}
      />
    </div>
  );
}
