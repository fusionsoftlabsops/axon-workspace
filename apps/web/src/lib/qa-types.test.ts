import { describe, it, expect } from 'vitest';
import { asHandoff, asQaTests, formatQaHandoffComment, type QaHandoff } from './qa-types';

describe('qa-types', () => {
  it('asHandoff normalizes partial/garbage input', () => {
    expect(asHandoff(null)).toBeNull();
    expect(asHandoff('x')).toBeNull();
    const h = asHandoff({ criteria: [{ text: 'a', met: true }] });
    expect(h?.criteria).toHaveLength(1);
    expect(h?.suggestedTests).toEqual([]);
    expect(h?.executedTasks).toEqual([]);
  });

  it('asQaTests requires a tests array', () => {
    expect(asQaTests({})).toBeNull();
    expect(asQaTests({ tests: [{ title: 'x' }], generatedAt: 'now' })?.tests).toHaveLength(1);
  });

  it('formatQaHandoffComment renders all sections', () => {
    const h: QaHandoff = {
      criteria: [
        { text: 'ok', met: true },
        { text: 'missing', met: false },
      ],
      suggestedTests: [{ title: 'Login', steps: '1..', expected: 'entra' }],
      executedTasks: ['form', 'endpoint'],
      notes: 'contexto',
      submittedAt: '',
    };
    const md = formatQaHandoffComment(h);
    expect(md).toContain('Cierre de HU');
    expect(md).toContain('✅ ok');
    expect(md).toContain('❌ missing');
    expect(md).toContain('**Login**');
    expect(md).toContain('- form');
    expect(md).toContain('contexto');
  });

  it('formatQaHandoffComment omits empty sections', () => {
    const md = formatQaHandoffComment({ criteria: [], suggestedTests: [], executedTasks: [], submittedAt: '' });
    expect(md).not.toContain('Criterios');
    expect(md).toContain('Cierre de HU');
  });
});
