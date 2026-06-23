'use client';

import { useState, type InputHTMLAttributes } from 'react';
import styles from './SignupForm.module.scss';
import { useI18n } from '@/lib/i18n/i18n';

/** Text/password input with a show/hide eye toggle. */
export function PasswordInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  const { t } = useI18n();
  return (
    <span className={styles.pwWrap}>
      <input {...props} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className={styles.pwToggle}
        onClick={() => setShow((s) => !s)}
        aria-label={show ? t('Ocultar', 'Hide') : t('Mostrar', 'Show')}
        title={show ? t('Ocultar', 'Hide') : t('Mostrar', 'Show')}
        tabIndex={-1}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </span>
  );
}

function EyeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.12 9.12 0 0 0 5.39-1.61" />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
