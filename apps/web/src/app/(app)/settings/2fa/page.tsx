import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { redirect } from 'next/navigation';
import { TotpEnrollment } from './TotpEnrollment';
import { TotpStatus } from './TotpStatus';

export default async function TwoFactorPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { totpSecretEncrypted: true },
  });

  const enrolled = !!user?.totpSecretEncrypted;

  return (
    <div style={{ maxWidth: '640px', padding: '2rem' }}>
      <h1>Autenticación de dos factores</h1>
      <p>
        El segundo factor (TOTP) protege tu cuenta. Es independiente de la passphrase del vault.
      </p>

      {enrolled ? <TotpStatus /> : <TotpEnrollment email={session.user.email ?? ''} />}
    </div>
  );
}
