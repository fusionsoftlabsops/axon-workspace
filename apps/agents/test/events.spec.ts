import { describe, it, expect } from 'vitest';
import { parseDomainEvent, AGENT_EVENTS_CHANNEL } from '../src/events.js';

const VALID = {
  v: 1,
  type: 'story.state_changed',
  projectId: 'p1',
  storyId: 't1',
  storyNumber: 7,
  fromState: { id: 'a' },
  toState: { id: 'b', name: 'Desarrollo', category: 'IN_PROGRESS' },
  actorId: 'u1',
  assigneeId: null,
  payload: { via: 'api' },
  ts: '2026-07-03T12:00:00.000Z',
};

describe('parseDomainEvent', () => {
  it('el canal coincide con el productor (axon-web)', () => {
    expect(AGENT_EVENTS_CHANNEL).toBe('axon:agents:events:v1');
  });

  it('acepta un evento v1 completo', () => {
    const e = parseDomainEvent(JSON.stringify(VALID));
    expect(e).toMatchObject({ type: 'story.state_changed', storyNumber: 7 });
  });

  it('acepta el mínimo (sin opcionales)', () => {
    const e = parseDomainEvent(
      JSON.stringify({ v: 1, type: 'story.created', projectId: 'p', storyId: 's', actorId: 'u', ts: 'x' }),
    );
    expect(e?.type).toBe('story.created');
  });

  it('descarta JSON malformado', () => {
    expect(parseDomainEvent('{nope')).toBeNull();
  });

  it('descarta versiones futuras (v2) sin tumbar el worker', () => {
    expect(parseDomainEvent(JSON.stringify({ ...VALID, v: 2 }))).toBeNull();
  });

  it('descarta tipos desconocidos', () => {
    expect(parseDomainEvent(JSON.stringify({ ...VALID, type: 'story.deleted' }))).toBeNull();
  });
});
