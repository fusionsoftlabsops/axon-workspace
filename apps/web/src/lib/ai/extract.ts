/** Text extraction for plan context: PDFs (unpdf), plain text, and web links.
 *  Images are NOT extracted here — they're passed to Claude as native image
 *  blocks. Everything is truncated to keep the model prompt bounded. */

const MAX_CHARS = 60_000;
const TEXT_EXTS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'yaml', 'yml', 'log', 'xml', 'html'];

export function isImageMime(mime: string): boolean {
  return /^image\/(png|jpe?g|gif|webp)$/i.test(mime);
}

/** Extract text from a document buffer. Returns '' for unsupported types. */
export async function extractText(buf: Buffer | Uint8Array, mimeType: string, name: string): Promise<string> {
  const m = (mimeType || '').toLowerCase();
  const ext = (name.toLowerCase().split('.').pop() ?? '').trim();
  try {
    if (m === 'application/pdf' || ext === 'pdf') {
      const { getDocumentProxy, extractText: pdfText } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const result = await pdfText(pdf, { mergePages: true });
      const text: unknown = result.text;
      const str = typeof text === 'string' ? text : Array.isArray(text) ? text.join('\n') : '';
      return str.slice(0, MAX_CHARS);
    }
    if (m.startsWith('text/') || m === 'application/json' || TEXT_EXTS.includes(ext)) {
      return Buffer.from(buf).toString('utf8').slice(0, MAX_CHARS);
    }
  } catch {
    /* extraction failed — return empty, the attachment still lists */
  }
  return '';
}

/** Fetch a URL and reduce it to readable text (no HTML). Best-effort. */
export async function fetchUrlText(url: string): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; AxonPlanner/1.0)' },
    signal: AbortSignal.timeout(15000),
    redirect: 'follow',
  });
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch?.[1]?.trim() ?? '';
  if (!title) {
    try {
      title = new URL(url).hostname;
    } catch {
      title = url;
    }
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: title.slice(0, 200), text: text.slice(0, MAX_CHARS) };
}
