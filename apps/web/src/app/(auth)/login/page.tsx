import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from './LoginForm';

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ signed_up?: string; callbackUrl?: string }>;
}) {
  return (
    <>
      <h1>Iniciar sesión</h1>
      <AwaitedFlash searchParams={searchParams} />
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
        ¿No tienes cuenta? <Link href="/signup">Regístrate</Link>
      </p>
    </>
  );
}

async function AwaitedFlash({
  searchParams,
}: {
  searchParams: Promise<{ signed_up?: string }>;
}) {
  const params = await searchParams;
  if (params.signed_up === '1') {
    return (
      <p style={{ color: 'var(--color-success)', fontSize: '0.9rem' }}>
        Cuenta creada. Inicia sesión.
      </p>
    );
  }
  return null;
}
