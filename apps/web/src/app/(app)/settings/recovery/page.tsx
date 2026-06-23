import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n/server';
import { RecoveryPanel } from './RecoveryPanel';

export default async function RecoveryPage() {
  const t = await getServerT();
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { encryptedPrivKeyRecovery: true },
  });
  const hasRecovery = !!user?.encryptedPrivKeyRecovery;

  return (
    <div style={{ maxWidth: '640px', padding: '2rem' }}>
      <h1>{t('Recuperación del vault', 'Vault recovery')}</h1>
      <p>
        {t(
          'Tu código de recuperación es la única forma de recuperar el vault si olvidas la passphrase. El servidor nunca conoce el código.',
          'Your recovery code is the only way to recover the vault if you forget the passphrase. The server never knows the code.',
        )}
      </p>
      <RecoveryPanel hasRecovery={hasRecovery} />
    </div>
  );
}
