/**
 * Narración del equipo: helper best-effort para que cada rol cuente su turno
 * en el chat del equipo (tomé la HU, terminé, te toca al siguiente). Narrar
 * JAMÁS rompe el trabajo: cualquier fallo se loguea y se descarta.
 */
import type { AxonApi } from '../api/client.js';

export async function narrate(
  api: AxonApi,
  slug: string,
  body: string,
  opts: { kind?: 'CHAT' | 'STATUS' | 'HANDOFF'; storyNumber?: number } = {},
): Promise<void> {
  try {
    await api.postTeamChat(slug, { body, kind: opts.kind ?? 'STATUS', storyNumber: opts.storyNumber });
  } catch (err) {
    console.error('[agents] narrate falló:', err instanceof Error ? err.message : err);
  }
}
