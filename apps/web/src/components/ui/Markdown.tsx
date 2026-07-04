'use client';

/**
 * Render de markdown enriquecido para chats y paneles (GFM: tablas, checklists,
 * código, links). Sin HTML crudo (react-markdown lo omite por defecto → seguro
 * ante inyección). Variante `compact` para burbujas de chat.
 */
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './Markdown.module.scss';

export function Markdown({ children, compact = false }: { children: string; compact?: boolean }) {
  return (
    <div className={compact ? `${styles.md} ${styles.compact}` : styles.md} data-testid="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
