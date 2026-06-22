import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { RecoveryPanel } from './RecoveryPanel';

export default async function RecoveryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { encryptedPrivKeyRecovery: true },
  });
  const hasRecovery = !!user?.encryptedPrivKeyRecovery;

  return (
    <div style={{ maxWidth: '640px', padding: '2rem' }}>
      <h1>Recuperación del vault</h1>
      <p>
        Tu código de recuperación es la única forma de recuperar el vault si olvidas la
        passphrase. El servidor nunca conoce el código.
      </p>
      <RecoveryPanel hasRecovery={hasRecovery} />
    </div>
  );
}
