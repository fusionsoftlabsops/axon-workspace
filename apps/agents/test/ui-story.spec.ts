import { describe, it, expect } from 'vitest';
import { looksLikeUi } from '../src/ui-story.js';

describe('looksLikeUi', () => {
  it('detecta HUs de UI por título/descripción (es/en)', () => {
    expect(looksLikeUi({ title: 'Rediseñar la pantalla de login' })).toBe(true);
    expect(looksLikeUi({ title: 'Add a settings screen' })).toBe(true);
    expect(looksLikeUi({ title: 'Botón de exportar en el tablero' })).toBe(true);
    expect(looksLikeUi({ title: 'Formulario', description: 'un modal responsive' })).toBe(true);
    expect(looksLikeUi({ title: 'Componente Card reutilizable' })).toBe(true);
  });

  it('detecta por categoría', () => {
    expect(looksLikeUi({ title: 'X', category: 'frontend' })).toBe(true);
    expect(looksLikeUi({ title: 'X', category: 'Diseño' })).toBe(true);
    expect(looksLikeUi({ title: 'X', category: 'backend' })).toBe(false);
  });

  it('NO marca como UI las HUs de backend/infra', () => {
    expect(looksLikeUi({ title: 'Agregar índice a la tabla de usuarios' })).toBe(false);
    expect(looksLikeUi({ title: 'Cachear el endpoint de reportes en Redis' })).toBe(false);
    expect(looksLikeUi({ title: 'Migrar el worker a Node 22' })).toBe(false);
    expect(looksLikeUi({ title: '', description: '' })).toBe(false);
  });

  it('usa límite de palabra (no falsos positivos por subcadenas)', () => {
    // "view" no debe dispararse dentro de "review"/"overview"
    expect(looksLikeUi({ title: 'Escribir un review del código de pagos' })).toBe(false);
  });
});

import { looksComplex } from '../src/ui-story.js';

describe('looksComplex', () => {
  it('compleja: ≥5 criterios, o URGENT, o HIGH con descripción larga', () => {
    expect(looksComplex({ acceptanceCriteria: ['a','b','c','d','e'].map((x)=>`- [ ] ${x}`).join('\n') })).toBe(true);
    expect(looksComplex({ priority: 'URGENT', acceptanceCriteria: '- [ ] uno' })).toBe(true);
    expect(looksComplex({ priority: 'HIGH', description: 'x'.repeat(500), acceptanceCriteria: '- [ ] uno' })).toBe(true);
  });
  it('no compleja: pocos criterios y prioridad normal', () => {
    expect(looksComplex({ acceptanceCriteria: '- [ ] uno\n- [ ] dos', priority: 'MEDIUM' })).toBe(false);
    expect(looksComplex({ priority: 'HIGH', description: 'corta', acceptanceCriteria: '- [ ] uno' })).toBe(false);
    expect(looksComplex({})).toBe(false);
  });
});

import { looksLikeMarketing } from '../src/ui-story.js';

describe('looksLikeMarketing', () => {
  it('detecta HUs de go-to-market', () => {
    expect(looksLikeMarketing({ title: 'Landing de lanzamiento' })).toBe(true);
    expect(looksLikeMarketing({ title: 'Optimizar SEO del blog' })).toBe(true);
    expect(looksLikeMarketing({ title: 'X', category: 'marketing' })).toBe(true);
    expect(looksLikeMarketing({ title: 'Copy de la campaña de social' })).toBe(true);
  });
  it('NO marca backend/UI como marketing', () => {
    expect(looksLikeMarketing({ title: 'Agregar índice a la tabla' })).toBe(false);
    expect(looksLikeMarketing({ title: 'Rediseñar el botón del tablero' })).toBe(false);
  });
});
