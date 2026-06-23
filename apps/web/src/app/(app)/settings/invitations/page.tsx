import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n/server';
import { listInvitationsAction } from '@/lib/actions/invitations';
import { InvitationsPanel } from './InvitationsPanel';

export default async function InvitationsPage() {
  const t = await getServerT();
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!session.user.isMasterUser) redirect('/projects');

  const res = await listInvitationsAction();
  const invites = res.ok ? res.data : [];

  return (
    <div style={{ maxWidth: '760px', padding: '2rem' }}>
      <h1>{t('Invitaciones', 'Invitations')}</h1>
      <p>
        {t('El registro es ', 'Sign-up is ')}
        <strong>{t('solo por invitación', 'by invitation only')}</strong>
        {t(
          '. Generá un enlace para invitar a alguien (válido 7 días). El enlace se muestra una sola vez.',
          '. Generate a link to invite someone (valid for 7 days). The link is shown only once.',
        )}
      </p>
      <InvitationsPanel initial={invites} />
    </div>
  );
}
