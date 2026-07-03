import { describe, it, expect, vi, beforeEach } from 'vitest';

let envConfig: Record<string, unknown>;
vi.mock('@/lib/env', () => ({ env: () => envConfig }));

const publishMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/realtime', () => ({ publish: publishMock }));

import { AGENT_EVENTS_CHANNEL, agentEventsEnabled, publishDomainEvent } from './events';

const EVT = {
  type: 'story.state_changed' as const,
  projectId: 'p1',
  storyId: 's1',
  storyNumber: 7,
  fromState: { id: 'a' },
  toState: { id: 'b', name: 'Desarrollo', category: 'IN_PROGRESS' },
  actorId: 'u1',
  assigneeId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  envConfig = {};
  publishMock.mockResolvedValue(undefined);
});

describe('agentEventsEnabled', () => {
  it('is off by default (feature ships dark)', () => {
    expect(agentEventsEnabled()).toBe(false);
  });

  it.each(['1', 'true', 'on', 'TRUE', 'On'])('is on with AGENT_EVENTS_ENABLED=%s', (v) => {
    envConfig = { AGENT_EVENTS_ENABLED: v };
    expect(agentEventsEnabled()).toBe(true);
  });

  it('is off with unrecognized values', () => {
    envConfig = { AGENT_EVENTS_ENABLED: 'yes' };
    expect(agentEventsEnabled()).toBe(false);
  });

  it('is off when env() throws (misconfigured environment never breaks mutations)', () => {
    const throwing = () => {
      throw new Error('bad env');
    };
    envConfig = new Proxy({}, { get: throwing }) as Record<string, unknown>;
    expect(agentEventsEnabled()).toBe(false);
  });
});

describe('publishDomainEvent', () => {
  it('does not publish when the flag is off', () => {
    publishDomainEvent(EVT);
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('publishes a v1 envelope with ts on the agents channel when enabled', () => {
    envConfig = { AGENT_EVENTS_ENABLED: '1' };
    publishDomainEvent(EVT);
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [channel, event] = publishMock.mock.calls[0]!;
    expect(channel).toBe(AGENT_EVENTS_CHANNEL);
    expect(event).toMatchObject({ ...EVT, v: 1 });
    expect(typeof event.ts).toBe('string');
    expect(Number.isNaN(Date.parse(event.ts as string))).toBe(false);
  });

  it('swallows publish failures (fire-and-forget, never breaks the mutation)', async () => {
    envConfig = { AGENT_EVENTS_ENABLED: 'true' };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    publishMock.mockRejectedValue(new Error('redis down'));
    expect(() => publishDomainEvent(EVT)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
