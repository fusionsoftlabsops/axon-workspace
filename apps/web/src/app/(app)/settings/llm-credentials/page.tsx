import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { LlmCredentialsPanel } from './LlmCredentialsPanel';

export default async function LlmCredentialsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;

  const [creds, projects] = await Promise.all([
    prisma.llmCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        label: true,
        keyPrefix: true,
        modelDefault: true,
        lastUsedAt: true,
        createdAt: true,
        revokedAt: true,
        projectId: true,
      },
    }),
    prisma.project.findMany({
      where: { members: { some: { userId } } },
      select: { id: true, slug: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  return (
    <div style={{ maxWidth: '900px', padding: '2rem 1.5rem' }}>
      <h1>Credenciales LLM</h1>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        API keys cifradas server-side con la clave del proceso (XSalsa20-Poly1305). Son necesarias
        para generar HUs con Claude, GPT, Gemini o Kimi. Un dump de DB sin acceso al server key no
        revela los secretos.
      </p>
      <LlmCredentialsPanel
        credentials={creds.map((c) => ({
          ...c,
          lastUsedAt: c.lastUsedAt?.toISOString() ?? null,
          createdAt: c.createdAt.toISOString(),
          revokedAt: c.revokedAt?.toISOString() ?? null,
        }))}
        projects={projects}
      />
    </div>
  );
}
