import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { listInvitationsAction } from '@/lib/actions/invitations';
import { InvitationsPanel } from './InvitationsPanel';

export default async function InvitationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  if (!session.user.isMasterUser) redirect('/projects');

  const res = await listInvitationsAction();
  const invites = res.ok ? res.data : [];

  return (
    <div style={{ maxWidth: '760px', padding: '2rem' }}>
      <h1>Invitaciones</h1>
      <p>
        El registro es <strong>solo por invitación</strong>. Generá un enlace para invitar a
        alguien (válido 7 días). El enlace se muestra una sola vez.
      </p>
      <InvitationsPanel initial={invites} />
    </div>
  );
}
