import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

let _transport: Transporter | null | undefined;

/** Lazily build the SMTP transport, or null if SMTP isn't configured. */
function transport(): Transporter | null {
  if (_transport !== undefined) return _transport;
  const e = env();
  if (!e.SMTP_HOST || !e.SMTP_USER || !e.SMTP_PASS) {
    _transport = null;
    return _transport;
  }
  const port = e.SMTP_PORT ? Number(e.SMTP_PORT) : 587;
  // Honor SMTP_SECURE if the platform/app provides it; otherwise derive from the
  // port (implicit TLS on 465, STARTTLS elsewhere).
  const secure =
    e.SMTP_SECURE === 'true' ? true : e.SMTP_SECURE === 'false' ? false : port === 465;
  _transport = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port,
    secure,
    auth: { user: e.SMTP_USER, pass: e.SMTP_PASS },
  });
  return _transport;
}

/** Whether outbound email is configured (SMTP env present). */
export function isMailConfigured(): boolean {
  return transport() !== null;
}

/**
 * Best-effort email send. Returns true on success, false if SMTP isn't
 * configured or the send failed (never throws — email is an optional channel).
 */
export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<boolean> {
  const t = transport();
  if (!t) return false;
  const e = env();
  const from = e.SMTP_FROM || e.SMTP_USER!;
  try {
    await t.sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html, text: opts.text });
    return true;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mailer] send failed:', err instanceof Error ? err.message : err);
    return false;
  }
}
