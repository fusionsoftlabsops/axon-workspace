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
