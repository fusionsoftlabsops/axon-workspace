/**
 * Credencial sintética del SERVIDOR (forgeia: fallback para generación de HUs).
 *
 * Usa la misma ANTHROPIC_API_KEY de entorno que ya alimenta el chat del Plan —
 * mismo perímetro de confianza: cualquier miembro del proyecto ya puede
 * consumir esa key vía planner. Vive fuera de stories.ts porque un archivo
 * 'use server' solo puede exportar funciones async.
 */
import { env } from '@/lib/env';

export const SERVER_CREDENTIAL_ID = 'server';

export function serverCredentialAvailable(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}
