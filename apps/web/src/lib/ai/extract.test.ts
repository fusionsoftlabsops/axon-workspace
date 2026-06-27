import { describe, it, expect, vi, beforeEach } from 'vitest';

const getDocumentProxy = vi.fn();
const pdfText = vi.fn();
vi.mock('unpdf', () => ({
  getDocumentProxy: (...a: unknown[]) => getDocumentProxy(...a),
  extractText: (...a: unknown[]) => pdfText(...a),
}));

import { isImageMime, extractText, fetchUrlText } from './extract';

beforeEach(() => {
  getDocumentProxy.mockReset();
  pdfText.mockReset();
});

describe('isImageMime', () => {
  it('matches common raster image mimes', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isImageMime('image/JPEG')).toBe(true);
    expect(isImageMime('image/webp')).toBe(true);
    expect(isImageMime('image/svg+xml')).toBe(false);
    expect(isImageMime('application/pdf')).toBe(false);
  });
});

describe('extractText', () => {
  it('reads plain text by mime', async () => {
    const out = await extractText(Buffer.from('hello'), 'text/plain', 'a.txt');
    expect(out).toBe('hello');
  });

  it('reads json/known extensions even with a generic mime', async () => {
    expect(await extractText(Buffer.from('{"a":1}'), 'application/json', 'x')).toBe('{"a":1}');
    expect(await extractText(Buffer.from('k: v'), '', 'config.yaml')).toBe('k: v');
  });

  it('returns empty for unsupported types', async () => {
    expect(await extractText(Buffer.from('bin'), 'application/octet-stream', 'a.bin')).toBe('');
  });

  it('truncates very large text to the cap', async () => {
    const big = 'a'.repeat(70_000);
    const out = await extractText(Buffer.from(big), 'text/plain', 'big.txt');
    expect(out.length).toBe(60_000);
  });

  it('extracts a PDF when text comes back as a string', async () => {
    getDocumentProxy.mockResolvedValue({});
    pdfText.mockResolvedValue({ text: 'pdf body' });
    expect(await extractText(new Uint8Array([1, 2]), 'application/pdf', 'doc')).toBe('pdf body');
    expect(pdfText).toHaveBeenCalledWith(expect.anything(), { mergePages: true });
  });

  it('joins a PDF text array', async () => {
    getDocumentProxy.mockResolvedValue({});
    pdfText.mockResolvedValue({ text: ['p1', 'p2'] });
    expect(await extractText(Buffer.from('x'), '', 'report.pdf')).toBe('p1\np2');
  });

  it('returns empty string when PDF text is neither string nor array', async () => {
    getDocumentProxy.mockResolvedValue({});
    pdfText.mockResolvedValue({ text: 123 });
    expect(await extractText(Buffer.from('x'), 'application/pdf', 'd.pdf')).toBe('');
  });

  it('swallows extraction errors and returns empty', async () => {
    getDocumentProxy.mockRejectedValue(new Error('boom'));
    expect(await extractText(Buffer.from('x'), 'application/pdf', 'd.pdf')).toBe('');
  });
});

describe('fetchUrlText', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('extracts the title and strips html to readable text + decodes entities', async () => {
    fetchMock.mockResolvedValue({
      text: async () =>
        '<html><head><title> My Page </title></head><body><script>bad()</script><style>.x{}</style><!--c--><p>Hello&nbsp;&amp;&lt;&gt;&quot;world</p></body></html>',
    });
    const { title, text } = await fetchUrlText('http://example.com');
    expect(title).toBe('My Page');
    expect(text).toContain('Hello &<>"world');
    expect(text).not.toContain('bad()');
    expect(text).not.toContain('.x{}');
  });

  it('falls back to the hostname when there is no title', async () => {
    fetchMock.mockResolvedValue({ text: async () => '<body>content</body>' });
    const { title } = await fetchUrlText('https://host.example.org/path');
    expect(title).toBe('host.example.org');
  });

  it('falls back to the raw url when it cannot be parsed and there is no title', async () => {
    fetchMock.mockResolvedValue({ text: async () => 'plain text no title' });
    const { title } = await fetchUrlText('not-a-valid-url');
    expect(title).toBe('not-a-valid-url');
  });
});
