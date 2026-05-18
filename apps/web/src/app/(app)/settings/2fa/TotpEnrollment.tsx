'use client';

import { useEffect, useState, useTransition } from 'react';
import QRCode from 'qrcode';
import { beginTotpEnrollment, confirmTotpEnrollment } from '@/lib/actions/totp';

export function TotpEnrollment({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enrolled, setEnrolled] = useState(false);

  useEffect(() => {
    // Auto-start enrollment on mount so QR is ready instantly.
    let cancelled = false;
    void (async () => {
      try {
        const { secret: s, otpauthUri } = await beginTotpEnrollment();
        if (cancelled) return;
        const qr = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 220 });
        setSecret(s);
        setQrDataUrl(qr);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Error iniciando 2FA');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!secret) return;
    startTransition(async () => {
      const result = await confirmTotpEnrollment(secret, code);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEnrolled(true);
    });
  }

  if (enrolled) {
    return (
      <p style={{ color: 'var(--color-success)' }}>
        ✓ 2FA habilitado. En tu próximo login se te pedirá el código.
      </p>
    );
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <ol>
        <li>Abre tu app de autenticación (Google Authenticator, 1Password, Aegis…).</li>
        <li>Escanea el QR o ingresa el código manualmente.</li>
        <li>Confirma con el código que muestra la app.</li>
      </ol>

      {qrDataUrl ? (
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginTop: '1rem' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qrDataUrl} alt="QR de configuración TOTP" width={220} height={220} />
          <div>
            <p style={{ marginTop: 0, fontSize: '0.85rem' }}>
              <strong>Cuenta:</strong> {email}
            </p>
            <p style={{ fontSize: '0.85rem' }}>
              <strong>Código manual:</strong>
              <br />
              <code style={{ wordBreak: 'break-all' }}>{secret}</code>
            </p>
          </div>
        </div>
      ) : (
        <p style={{ color: 'var(--color-fg-muted)' }}>Generando QR…</p>
      )}

      <form onSubmit={submit} style={{ marginTop: '1.5rem', display: 'flex', gap: '0.5rem' }}>
        <input
          type="text"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          placeholder="Código de 6 dígitos"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          required
          style={{
            padding: '0.6rem 0.8rem',
            border: '1px solid var(--color-border)',
            borderRadius: '8px',
            background: 'var(--color-bg)',
            color: 'var(--color-fg)',
            font: 'inherit',
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.2em',
            width: '180px',
          }}
        />
        <button
          type="submit"
          disabled={pending || !secret}
          style={{
            padding: '0.6rem 1rem',
            border: 'none',
            borderRadius: '8px',
            background: 'var(--color-accent)',
            color: 'var(--color-accent-fg)',
            fontWeight: 600,
          }}
        >
          {pending ? 'Verificando…' : 'Habilitar 2FA'}
        </button>
      </form>

      {error && (
        <p style={{ color: 'var(--color-danger)', marginTop: '0.5rem' }}>{error}</p>
      )}
    </div>
  );
}
