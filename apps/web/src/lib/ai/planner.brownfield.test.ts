import { describe, it, expect } from 'vitest';
import { codeMapBlock, chatSystem, genSystem } from './planner';

describe('codeMapBlock', () => {
  it('is empty without a code context (greenfield)', () => {
    expect(codeMapBlock()).toBe('');
    expect(codeMapBlock('   ')).toBe('');
  });

  it('embeds the code map and the "do not rebuild" instruction (brownfield)', () => {
    const block = codeMapBlock('Tamaño: 500 nodos. OrchestratorService.');
    expect(block).toContain('CODE_MAP');
    expect(block).toContain('OrchestratorService');
    expect(block).toContain('NO propongas reconstruir');
  });
});

describe('chatSystem / genSystem brownfield switch', () => {
  it('chatSystem stays greenfield without a code context', () => {
    const s = chatSystem('es');
    expect(s).toContain('nuevo proyecto');
    expect(s).not.toContain('CODE_MAP');
  });

  it('chatSystem switches to brownfield with a code context', () => {
    const s = chatSystem('es', 'Tamaño: 500 nodos.');
    expect(s).toContain('YA EXISTENTE');
    expect(s).toContain('CODE_MAP');
  });

  it('genSystem injects the brownfield rule only with a code context', () => {
    expect(genSystem('es')).not.toContain('MAPA DEL CÓDIGO');
    expect(genSystem('es', 'Tamaño: 500 nodos.')).toContain('YA EXISTE');
  });
});
