import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  envConfig: { OPENAI_API_KEY: 'sk-proj-x', OPENAI_IMAGE_MODEL: 'gpt-image-1' } as Record<string, unknown>,
  buildKey: vi.fn(() => 'axon/image/2026-07/abc-mock.png'),
  putObject: vi.fn(),
  isStorageConfigured: vi.fn(() => true),
  fileCreate: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env: () => h.envConfig }));
vi.mock('@/lib/storage', () => ({
  buildKey: h.buildKey,
  putObject: h.putObject,
  isStorageConfigured: h.isStorageConfigured,
}));
vi.mock('@/lib/db', () => ({ prisma: { projectFile: { create: h.fileCreate } } }));

import { generateImage, generateAndStoreProjectImage, imageGenerationConfigured } from './image';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;
// 1x1 png bytes → base64
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  h.envConfig = { OPENAI_API_KEY: 'sk-proj-x', OPENAI_IMAGE_MODEL: 'gpt-image-1' };
  h.isStorageConfigured.mockReturnValue(true);
  h.putObject.mockReset();
  h.fileCreate.mockReset();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('imageGenerationConfigured', () => {
  it('true con OPENAI_API_KEY, false sin ella', () => {
    expect(imageGenerationConfigured()).toBe(true);
    h.envConfig = { OPENAI_IMAGE_MODEL: 'gpt-image-1' };
    expect(imageGenerationConfigured()).toBe(false);
  });
});

describe('generateImage', () => {
  it('llama a gpt-image-1 con el Bearer y decodifica el b64_json', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => '', json: async () => ({ data: [{ b64_json: PNG_B64 }] }) });
    const buf = await generateImage({ prompt: 'un botón azul', size: '1024x1024' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/v1/images/generations');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-proj-x');
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'gpt-image-1', prompt: 'un botón azul', size: '1024x1024', n: 1 });
    expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47'); // PNG magic
  });

  it('lanza si falta la key o el API falla', async () => {
    h.envConfig = { OPENAI_IMAGE_MODEL: 'gpt-image-1' };
    await expect(generateImage({ prompt: 'x' })).rejects.toThrow('OPENAI_API_KEY');
    h.envConfig = { OPENAI_API_KEY: 'sk-proj-x', OPENAI_IMAGE_MODEL: 'gpt-image-1' };
    fetchMock.mockResolvedValue({ ok: false, status: 429, text: async () => 'rate limited' });
    await expect(generateImage({ prompt: 'x' })).rejects.toThrow('gpt-image 429');
  });
});

describe('generateAndStoreProjectImage', () => {
  it('genera, sube al bucket y crea el ProjectFile (IMAGE)', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ b64_json: PNG_B64 }] }) });
    const out = await generateAndStoreProjectImage({ projectId: 'p1', slug: 'axon', prompt: 'hero', userId: 'u1' });
    expect(out.name.endsWith('.png')).toBe(true);
    expect(h.putObject).toHaveBeenCalledWith(expect.any(String), expect.any(Buffer), 'image/png');
    expect(h.fileCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ projectId: 'p1', category: 'IMAGE', mimeType: 'image/png' }) }),
    );
  });

  it('lanza si el storage no está configurado', async () => {
    h.isStorageConfigured.mockReturnValue(false);
    await expect(
      generateAndStoreProjectImage({ projectId: 'p1', slug: 'axon', prompt: 'x', userId: 'u1' }),
    ).rejects.toThrow('Storage');
  });
});
