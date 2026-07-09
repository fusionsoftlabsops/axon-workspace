/** Extrae el número de PR del último link .../pull(s)/N en los comentarios
 *  (GitHub usa `/pull/N`, Forgejo/Gitea `/pulls/N`; se aceptan ambos). */
export function parsePrNumber(comments: Array<{ body: string }>): number | null {
  for (const c of [...comments].reverse()) {
    const m = c.body.match(/\/[^/\s]+\/[^/\s]+\/pulls?\/(\d+)/i);
    if (m) return parseInt(m[1]!, 10);
  }
  return null;
}
