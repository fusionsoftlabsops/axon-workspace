import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const sendMail = vi.fn();
  const createTransport = vi.fn(() => ({ sendMail }));
  const envValue: Record<string, unknown> = {};
  return { sendMail, createTransport, envValue };
});

vi.mock('nodemailer', () => ({
  default: { createTransport: h.createTransport },
  createTransport: h.createTransport,
}));

vi.mock('@/lib/env', () => ({ env: () => h.envValue }));

const CONFIGURED = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_USER: 'user@example.com',
  SMTP_PASS: 'secret',
};

beforeEach(() => {
  vi.resetModules();
  h.sendMail.mockReset().mockResolvedValue({ messageId: 'x' });
  h.createTransport.mockClear();
  for (const k of Object.keys(h.envValue)) delete h.envValue[k];
});

function setEnv(extra: Record<string, unknown> = {}) {
  Object.assign(h.envValue, CONFIGURED, extra);
}

describe('isMailConfigured', () => {
  it('is false when SMTP env is missing', async () => {
    const { isMailConfigured } = await import('./mailer');
    expect(isMailConfigured()).toBe(false);
    expect(h.createTransport).not.toHaveBeenCalled();
  });

  it('is true when SMTP host/user/pass are present', async () => {
    setEnv();
    const { isMailConfigured } = await import('./mailer');
    expect(isMailConfigured()).toBe(true);
    expect(h.createTransport).toHaveBeenCalledTimes(1);
  });

  it('caches the transport (createTransport called once across calls)', async () => {
    setEnv();
    const { isMailConfigured } = await import('./mailer');
    isMailConfigured();
    isMailConfigured();
    expect(h.createTransport).toHaveBeenCalledTimes(1);
  });
});

describe('transport configuration', () => {
  it('uses implicit TLS on port 465', async () => {
    setEnv({ SMTP_PORT: '465' });
    const { isMailConfigured } = await import('./mailer');
    isMailConfigured();
    expect(h.createTransport.mock.calls[0][0]).toMatchObject({ port: 465, secure: true });
  });

  it('honors SMTP_SECURE=true regardless of port', async () => {
    setEnv({ SMTP_PORT: '587', SMTP_SECURE: 'true' });
    const { isMailConfigured } = await import('./mailer');
    isMailConfigured();
    expect(h.createTransport.mock.calls[0][0]).toMatchObject({ port: 587, secure: true });
  });

  it('honors SMTP_SECURE=false on port 465', async () => {
    setEnv({ SMTP_PORT: '465', SMTP_SECURE: 'false' });
    const { isMailConfigured } = await import('./mailer');
    isMailConfigured();
    expect(h.createTransport.mock.calls[0][0]).toMatchObject({ port: 465, secure: false });
  });

  it('defaults to port 587 and non-secure when unset', async () => {
    setEnv();
    const { isMailConfigured } = await import('./mailer');
    isMailConfigured();
    expect(h.createTransport.mock.calls[0][0]).toMatchObject({ port: 587, secure: false });
  });
});

describe('sendMail', () => {
  const msg = { to: 'rcpt@example.com', subject: 'Hi', html: '<b>hi</b>', text: 'hi' };

  it('returns false when SMTP is not configured', async () => {
    const { sendMail } = await import('./mailer');
    expect(await sendMail(msg)).toBe(false);
    expect(h.sendMail).not.toHaveBeenCalled();
  });

  it('sends and returns true, defaulting from to SMTP_USER', async () => {
    setEnv();
    const { sendMail } = await import('./mailer');
    expect(await sendMail(msg)).toBe(true);
    expect(h.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: CONFIGURED.SMTP_USER, to: msg.to, subject: 'Hi' }),
    );
  });

  it('uses SMTP_FROM when provided', async () => {
    setEnv({ SMTP_FROM: 'noreply@example.com' });
    const { sendMail } = await import('./mailer');
    await sendMail(msg);
    expect(h.sendMail.mock.calls[0][0].from).toBe('noreply@example.com');
  });

  it('returns false and logs when the transport throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setEnv();
    h.sendMail.mockRejectedValueOnce(new Error('connection refused'));
    const { sendMail } = await import('./mailer');
    expect(await sendMail(msg)).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('handles a non-Error thrown value in the catch branch', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setEnv();
    h.sendMail.mockRejectedValueOnce('string failure');
    const { sendMail } = await import('./mailer');
    expect(await sendMail(msg)).toBe(false);
    spy.mockRestore();
  });
});
