import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { getServerT } from '@/lib/i18n/server';
import { TotpEnrollment } from './TotpEnrollment';
import { TotpStatus } from './TotpStatus';

export default async function TwoFactorPage() {
  const t = await getServerT();
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { totpSecretEncrypted: true },
  });

  const enrolled = !!user?.totpSecretEncrypted;

  return (
    <div style={{ maxWidth: '640px', padding: '2rem' }}>
      <h1>{t('Autenticación de dos factores', 'Two-factor authentication')}</h1>
      <p>
        {t(
          'El segundo factor (TOTP) protege tu cuenta. Es independiente de la passphrase del vault.',
          'The second factor (TOTP) protects your account. It is independent of the vault passphrase.',
        )}
      </p>

      {enrolled ? <TotpStatus /> : <TotpEnrollment email={session.user.email ?? ''} />}
    </div>
  );
}
