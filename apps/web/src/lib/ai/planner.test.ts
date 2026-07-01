import { describe, it, expect } from 'vitest';
import { toApiMessages, type ChatMsg } from './planner';

describe('toApiMessages', () => {
  it('strips collaboration-only fields the Anthropic API rejects', () => {
    const msgs: ChatMsg[] = [
      { role: 'assistant', content: 'hola' },
      {
        role: 'user',
        content: 'quiero X',
        authorId: 'u1',
        authorName: 'Ana',
        context: { sources: ['spec.md', 'Grafo de código'] },
      },
    ];
    const out = toApiMessages(msgs);
    expect(out).toEqual([
      { role: 'assistant', content: 'hola' },
      { role: 'user', content: 'quiero X' },
    ]);
    // No extra keys (authorId/authorName/context) survive.
    for (const m of out) expect(Object.keys(m).sort()).toEqual(['content', 'role']);
  });

  it('is a no-op shape for plain messages', () => {
    const msgs: ChatMsg[] = [{ role: 'user', content: 'hi' }];
    expect(toApiMessages(msgs)).toEqual([{ role: 'user', content: 'hi' }]);
  });
});
