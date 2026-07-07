'use server';

import { redirect } from 'next/navigation';
import { signIn } from '@/auth';

/**
 * Inicia el login federado por OIDC (Authentik). `signIn` lanza el redirect al
 * IdP (throw NEXT_REDIRECT), por eso esta acción no retorna: la navegación la
 * maneja Auth.js. Se usa como `action` de un <form> en la página de login, y
 * solo se muestra si el SSO está configurado (`isOidcConfigured`).
 */
export async function ssoLoginAction(): Promise<void> {
  await signIn('authentik', { redirectTo: '/projects' });
}

export async function logoutAction(): Promise<void> {
  const { signOut } = await import('@/auth');
  await signOut({ redirect: false });
  redirect('/login');
}
