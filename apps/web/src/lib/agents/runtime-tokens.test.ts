import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  upsert: vi.fn(),
  env: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: { agentRuntimeToken: { upsert: h.upsert } } }));
vi.mock('@/lib/env', () => ({ env: h.env }));

import { sealAgentToken, openAgentToken } from './runtime-tokens';

// clave de 32 bytes en base64url
const KEY = Buffer.alloc(32, 7).toString('base64url');

beforeEach(() => {
  h.upsert.mockReset();
  h.env.mockReturnValue({ AUTH_LLM_KEY: KEY });
});

describe('runtime-tokens seal/open', () => {
  it('sella y abre el mismo plaintext (round-trip)', async () => {
    let stored: { sealed: Buffer; nonce: Buffer } | null = null;
    h.upsert.mockImplementation(async ({ create }: { create: { sealed: Buffer; nonce: Buffer } }) => {
      stored = { sealed: create.sealed, nonce: create.nonce };
    });
    await sealAgentToken('p1', 'QA', 'ad_pk_secret_token_value');
    expect(stored).not.toBeNull();
    expect(openAgentToken(stored!)).toBe('ad_pk_secret_token_value');
  });

  it('upsert por (projectId, role) con keyPrefix', async () => {
    await sealAgentToken('p1', 'DEV', 'ad_pk_abcdefghij_more');
    const call = h.upsert.mock.calls[0]![0];
    expect(call.where).toEqual({ projectId_role: { projectId: 'p1', role: 'DEV' } });
    expect(call.create.keyPrefix).toBe('ad_pk_abcdef');
  });

  it('falla sin clave de sellado', () => {
    h.env.mockReturnValue({});
    expect(() => openAgentToken({ sealed: Buffer.alloc(1), nonce: Buffer.alloc(24) })).toThrow(/AUTH_LLM_KEY/);
  });
});
