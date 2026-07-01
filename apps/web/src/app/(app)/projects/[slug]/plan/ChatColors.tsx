'use client';

import { useTransition } from 'react';
import { useI18n } from '@/lib/i18n/i18n';
import { setChatColorAction } from '@/lib/actions/planning';
import { effectiveColor } from '@/lib/plan-colors';
import styles from './plan.module.scss';

/**
 * Small accordion card (under the planning context panel) to recolor each
 * member's chat bubble. Anyone can change anyone's color; the change is
 * optimistic locally and broadcast to everyone over SSE by the action.
 */
export function ChatColors({
  slug,
  members,
  colors,
  onColorsChange,
}: {
  slug: string;
  members: { userId: string; name: string }[];
  colors: Record<string, string>;
  onColorsChange: (colors: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const [pending, start] = useTransition();

  function pick(userId: string, color: string) {
    const prev = colors;
    onColorsChange({ ...colors, [userId]: color.toLowerCase() }); // optimistic
    start(async () => {
      const r = await setChatColorAction(slug, userId, color);
      if (!r.ok) {
        onColorsChange(prev); // revert on failure
      } else if (r.data) {
        onColorsChange(r.data);
      }
    });
  }

  if (members.length === 0) return null;

  return (
    <details className={styles.colorsCard}>
      <summary className={styles.colorsHead}>
        <span aria-hidden className={styles.colorsChevron}>▸</span>
        <span className={styles.colorsTitle}>{t('Colores del chat', 'Chat colors')}</span>
        <span className={styles.colorsCount}>{members.length}</span>
      </summary>
      <div className={styles.colorsBody}>
        <p className={styles.colorsHint}>
          {t('Clic en el color para cambiarlo. Cualquiera puede cambiar el de cualquiera.', 'Click a color to change it. Anyone can change anyone’s.')}
        </p>
        {members.map((m) => (
          <label key={m.userId} className={styles.colorRow}>
            <input
              type="color"
              className={styles.colorSwatch}
              value={effectiveColor(m.userId, colors, members)}
              disabled={pending}
              onChange={(e) => pick(m.userId, e.target.value)}
              aria-label={t(`Color de ${m.name}`, `${m.name}'s color`)}
            />
            <span className={styles.colorName}>{m.name || t('Anónimo', 'Anonymous')}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
