import Link from 'next/link';
import { SignupForm } from './SignupForm';

export default function SignupPage() {
  return (
    <>
      <h1>Crear cuenta</h1>
      <p>
        Tu passphrase nunca sale del navegador. Si la pierdes, perderás acceso al vault de
        credenciales.
      </p>
      <SignupForm />
      <p style={{ marginTop: '1.5rem', fontSize: '0.9rem' }}>
        ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>
      </p>
    </>
  );
}
