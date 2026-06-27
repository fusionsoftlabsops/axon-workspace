import { describe, it, expect } from 'vitest';
import {
  storyOutputSchema,
  subtaskSchema,
  fileToTouchSchema,
  STORY_OUTPUT_JSON_SCHEMA,
  buildStoryPrompt,
  treeOutline,
  tolerantParse,
  type StoryPromptInput,
} from './story-prompt';

function baseInput(over: Partial<StoryPromptInput> = {}): StoryPromptInput {
  return {
    rawInput: '  Quiero un login  ',
    memories: [],
    repoTreeOutline: 'apps/\n  web/',
    repoFiles: [],
    projectName: 'Axon',
    ...over,
  };
}

describe('buildStoryPrompt', () => {
  it('returns system + user with empty-context placeholders', () => {
    const msgs = buildStoryPrompt(baseInput());
    expect(msgs[0]!.role).toBe('system');
    expect(msgs[1]!.role).toBe('user');
    expect(msgs[1]!.content).toContain('## Proyecto: Axon');
    expect(msgs[1]!.content).toContain('Quiero un login');
    expect(msgs[1]!.content).toContain('Sin memorias relevantes.');
    expect(msgs[1]!.content).toContain('No se incluyeron archivos del repo');
  });

  it('renders memory and file sections, truncating long bodies', () => {
    const msgs = buildStoryPrompt(
      baseInput({
        memories: [
          { id: '7', type: 'PATTERN', title: 'Cache', body: 'x'.repeat(1000), tags: ['a', 'b'] },
          { id: '8', type: 'NOTE', title: 'NoTags', body: 'short', tags: [] },
        ],
        repoFiles: [
          { path: 'a.ts', content: 'const a=1', language: 'ts', truncated: true } as never,
          { path: 'b.md', content: '# hi', language: null, truncated: false } as never,
        ],
      }),
    );
    const user = msgs[1]!.content;
    expect(user).toContain('### Memoria M-7 · PATTERN · Cache');
    expect(user).toContain('Tags: a, b');
    expect(user).toContain('…'); // truncated body ellipsis
    expect(user).toContain('Tags: —'); // empty tags fallback
    expect(user).toContain('### `a.ts` (truncado)');
    expect(user).toContain('### `b.md`');
  });
});

describe('treeOutline', () => {
  it('renders dirs, nested children and files', () => {
    const out = treeOutline([
      { name: 'src', kind: 'dir', children: [{ name: 'index.ts', kind: 'file' }] },
      { name: 'README.md', kind: 'file' },
      { name: 'empty', kind: 'dir' },
    ]);
    expect(out).toContain('├─ src/');
    expect(out).toContain('│  index.ts');
    expect(out).toContain('│  README.md');
    expect(out).toContain('├─ empty/');
  });
});

describe('tolerantParse', () => {
  it('parses clean JSON', () => {
    expect(tolerantParse('{"summary":"ok"}')).toEqual({ summary: 'ok' });
  });

  it('strips a ```json code fence', () => {
    expect(tolerantParse('```json\n{"summary":"fenced"}\n```')).toEqual({ summary: 'fenced' });
  });

  it('returns null when there is no opening brace', () => {
    expect(tolerantParse('no json here')).toBeNull();
  });

  it('closes an unclosed object', () => {
    const r = tolerantParse('{"summary":"partial","acceptanceCriteria":"a"');
    expect(r).toMatchObject({ summary: 'partial' });
  });

  it('closes nested unclosed structures', () => {
    const r = tolerantParse('{"summary":"s","subtaskBreakdown":[{"title":"t"}');
    expect(r).toMatchObject({ summary: 's' });
  });

  it('drops a dangling trailing comma before closing', () => {
    const r = tolerantParse('{"summary":"ok",');
    expect(r).toEqual({ summary: 'ok' });
  });

  it('slices to the last balanced delimiter when extra trailing text exists', () => {
    const r = tolerantParse('{"summary":"x"} trailing junk');
    expect(r).toEqual({ summary: 'x' });
  });

  it('returns null for an unparseable fragment with an open string mid-escape', () => {
    // A lone open quote with no close and no brackets to fix → cannot close safely.
    expect(tolerantParse('{"summary":"unterminated \\')).toBeNull();
  });
});

describe('tolerant preprocessors in storyOutputSchema', () => {
  const valid = {
    summary: 'Como usuario quiero X',
    acceptanceCriteria: '- [ ] a',
    technicalContext: 'ctx',
    subtaskBreakdown: [{ title: 'st', priority: 'high' }],
    filesToTouch: [{ path: 'a.ts', reason: 'edit' }],
    risks: 'r',
  };

  it('parses a fully valid story', () => {
    const out = storyOutputSchema.parse(valid);
    expect(out.subtaskBreakdown[0]!.priority).toBe('HIGH');
  });

  it('joins an array of strings into markdown bullets', () => {
    const out = storyOutputSchema.parse({ ...valid, acceptanceCriteria: ['one', '- two'] });
    expect(out.acceptanceCriteria).toBe('- one\n- two');
  });

  it('joins an array of objects using known text keys', () => {
    const out = storyOutputSchema.parse({
      ...valid,
      risks: [{ text: 'risk a' }, { description: 'risk b' }, { unknown: 1 }, 42],
    });
    expect(out.risks).toContain('- risk a');
    expect(out.risks).toContain('- risk b');
    expect(out.risks).toContain('- 42');
  });

  it('coerces empty/blank priority to undefined', () => {
    const out = storyOutputSchema.parse({ ...valid, subtaskBreakdown: [{ title: 'st', priority: '   ' }] });
    expect(out.subtaskBreakdown[0]!.priority).toBeUndefined();
    const out2 = storyOutputSchema.parse({ ...valid, subtaskBreakdown: [{ title: 'st', priority: null }] });
    expect(out2.subtaskBreakdown[0]!.priority).toBeUndefined();
  });

  it('subtask and fileToTouch schemas enforce bounds', () => {
    expect(() => subtaskSchema.parse({ title: '' })).toThrow();
    expect(() => fileToTouchSchema.parse({ path: 'a', reason: 'x'.repeat(501) })).toThrow();
  });

  it('exposes a JSON schema for structured providers', () => {
    expect(STORY_OUTPUT_JSON_SCHEMA.required).toContain('summary');
  });
});
