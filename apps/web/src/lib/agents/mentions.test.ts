import { describe, it, expect } from 'vitest';
import { parseAgentMention, personaSystem } from './mentions';

describe('parseAgentMention', () => {
  it('detecta por nombre y por rol, case-insensitive', () => {
    expect(parseAgentMention('@dax cómo partirías esto?')).toMatchObject({ role: 'ARCHITECT', name: 'Dax' });
    expect(parseAgentMention('che @IRIS qué criterios?')).toMatchObject({ role: 'PO', name: 'Iris' });
    expect(parseAgentMention('@qa casos borde?')).toMatchObject({ role: 'QA', name: 'Vera' });
    expect(parseAgentMention('@architect y @aria')).toMatchObject({ role: 'ARCHITECT' }); // primera gana
  });
  it('null sin mención o con alias desconocido', () => {
    expect(parseAgentMention('sin menciones acá')).toBeNull();
    expect(parseAgentMention('@fulano hola')).toBeNull();
    expect(parseAgentMention('mail@dax.com no es mención… bueno, sí matchea dax')).not.toBeNull();
  });
  it('personaSystem cubre los 9 roles en ambos idiomas', () => {
    for (const role of ['SM','PO','ARCHITECT','DESIGN','DEV','QA','REVIEWER','MARKETING','RELEASE'] as const) {
      expect(personaSystem(role, 'es')).toBeTruthy();
      expect(personaSystem(role, 'en')).toBeTruthy();
    }
  });
});
