import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { notFound } from 'next/navigation';

const ACTION_LABEL: Record<string, string> = {
  'project.create': 'Proyecto creado',
  'member.invite': 'Miembro invitado',
  'member.role_change': 'Rol cambiado',
  'member.remove': 'Miembro expulsado',
  'credential.create': 'Credencial creada',
  'credential.read': 'Credencial leída',
  'credential.share': 'Acceso compartido',
  'credential.revoke': 'Acceso revocado',
  'credential.delete': 'Credencial eliminada',
  'credential.rotate': 'Credencial rotada',
  'task.create': 'Tarea creada',
  'task.update': 'Tarea actualizada',
  'task.move': 'Tarea movida',
  'api_token.create': 'API token creado',
  'api_token.revoke': 'API token revocado',
  'ai.invoke': 'Llamada de IA',
};

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
      <h2>Auditoría</h2>
      <p style={{ color: 'var(--color-fg-muted)' }}>
        Últimos {days} días · {entries.length} eventos
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
          <option value="">Todas las acciones</option>
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
          <option value="1">1 día</option>
          <option value="7">7 días</option>
          <option value="30">30 días</option>
          <option value="90">90 días</option>
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
          Filtrar
        </button>
      </form>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
            <th style={{ padding: '0.5rem' }}>Cuándo</th>
            <th style={{ padding: '0.5rem' }}>Actor</th>
            <th style={{ padding: '0.5rem' }}>Acción</th>
            <th style={{ padding: '0.5rem' }}>Recurso</th>
            <th style={{ padding: '0.5rem' }}>Payload</th>
            <th style={{ padding: '0.5rem' }}>IP</th>
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
          Sin eventos en el rango seleccionado.
        </p>
      )}
    </div>
  );
}
