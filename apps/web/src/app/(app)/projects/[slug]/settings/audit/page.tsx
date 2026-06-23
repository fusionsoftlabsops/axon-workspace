import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';
import { getServerT } from '@/lib/i18n/server';

type T = (es: string, en: string) => string;

function buildActionLabels(t: T): Record<string, string> {
  return {
    'project.create': t('Proyecto creado', 'Project created'),
    'member.invite': t('Miembro invitado', 'Member invited'),
    'member.role_change': t('Rol cambiado', 'Role changed'),
    'member.remove': t('Miembro expulsado', 'Member removed'),
    'credential.create': t('Credencial creada', 'Credential created'),
    'credential.read': t('Credencial leída', 'Credential read'),
    'credential.share': t('Acceso compartido', 'Access shared'),
    'credential.revoke': t('Acceso revocado', 'Access revoked'),
    'credential.delete': t('Credencial eliminada', 'Credential deleted'),
    'credential.rotate': t('Credencial rotada', 'Credential rotated'),
    'task.create': t('Tarea creada', 'Task created'),
    'task.update': t('Tarea actualizada', 'Task updated'),
    'task.move': t('Tarea movida', 'Task moved'),
    'api_token.create': t('API token creado', 'API token created'),
    'api_token.revoke': t('API token revocado', 'API token revoked'),
    'ai.invoke': t('Llamada de IA', 'AI call'),
  };
}

export default async function AuditPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ action?: string; days?: string }>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const session = await auth();
  if (!session?.user?.id) return null;
  const t = await getServerT();
  const ACTION_LABEL = buildActionLabels(t);

  const project = await prisma.project.findUnique({
    where: { slug },
    select: {
      id: true,
      members: { where: { userId: session.user.id }, select: { role: true } },
    },
  });
  if (!project || project.members.length === 0) notFound();
  const role = project.members[0]!.role;
  if (role !== 'OWNER' && role !== 'ADMIN') notFound();

  const days = Math.min(Math.max(parseInt(sp.days || '7', 10) || 7, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const entries = await prisma.auditLog.findMany({
    where: {
      projectId: project.id,
      ...(sp.action ? { action: sp.action } : {}),
      createdAt: { gte: since },
    },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });

  return (
    <div style={{ maxWidth: '1000px', padding: '2rem 1.5rem' }}>
      <h2>{t('Auditoría', 'Audit')}</h2>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        {t(`Últimos ${days} días`, `Last ${days} days`)} · {t(`${entries.length} eventos`, `${entries.length} events`)}
      </p>

      <form
        style={{
          display: 'flex',
          gap: '0.5rem',
          marginBottom: '1rem',
          padding: '0.75rem',
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: '8px',
        }}
      >
        <select
          name="action"
          defaultValue={sp.action || ''}
          style={{
            padding: '0.4rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
          }}
        >
          <option value="">{t('Todas las acciones', 'All actions')}</option>
          {Object.keys(ACTION_LABEL).map((k) => (
            <option key={k} value={k}>
              {ACTION_LABEL[k]}
            </option>
          ))}
        </select>
        <select
          name="days"
          defaultValue={String(days)}
          style={{
            padding: '0.4rem',
            border: '1px solid var(--color-border)',
            borderRadius: '4px',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
          }}
        >
          <option value="1">{t('1 día', '1 day')}</option>
          <option value="7">{t('7 días', '7 days')}</option>
          <option value="30">{t('30 días', '30 days')}</option>
          <option value="90">{t('90 días', '90 days')}</option>
        </select>
        <button
          type="submit"
          style={{
            padding: '0.4rem 1rem',
            border: 'none',
            borderRadius: '4px',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            fontWeight: 600,
          }}
        >
          {t('Filtrar', 'Filter')}
        </button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
            <th style={{ padding: '0.5rem' }}>{t('Cuándo', 'When')}</th>
            <th style={{ padding: '0.5rem' }}>{t('Actor', 'Actor')}</th>
            <th style={{ padding: '0.5rem' }}>{t('Acción', 'Action')}</th>
            <th style={{ padding: '0.5rem' }}>{t('Recurso', 'Resource')}</th>
            <th style={{ padding: '0.5rem' }}>{t('Payload', 'Payload')}</th>
            <th style={{ padding: '0.5rem' }}>{t('IP', 'IP')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
              <td style={{ padding: '0.5rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
                {e.createdAt.toLocaleString()}
              </td>
              <td style={{ padding: '0.5rem' }}>
                {e.actor ? (
                  <span title={e.actor.email}>{e.actor.name}</span>
                ) : (
                  <span style={{ color: 'var(--color-fg-subtle)' }}>—</span>
                )}
              </td>
              <td style={{ padding: '0.5rem' }}>
                {ACTION_LABEL[e.action] ?? e.action}
              </td>
              <td style={{ padding: '0.5rem', fontFamily: 'var(--font-mono)', color: 'var(--color-fg-muted)' }}>
                {e.resourceType}/{e.resourceId.slice(0, 8)}
              </td>
              <td style={{ padding: '0.5rem', fontFamily: 'var(--font-mono)', fontSize: '0.75rem' }}>
                {e.payload ? JSON.stringify(e.payload) : ''}
              </td>
              <td style={{ padding: '0.5rem', color: 'var(--color-fg-subtle)', fontFamily: 'var(--font-mono)' }}>
                {e.ip ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {entries.length === 0 && (
        <p style={{ color: 'var(--color-fg-muted)', padding: '2rem', textAlign: 'center' }}>
          {t('Sin eventos en el rango seleccionado.', 'No events in the selected range.')}
        </p>
      )}
    </div>
  );
}
