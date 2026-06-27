import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ signup: vi.fn(), genKeys: vi.fn(), push: vi.fn(), writeText: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock('@/lib/actions/auth', () => ({ signupAction: h.signup }));
vi.mock('@/lib/crypto', () => ({
  generateProtectedKeypairWithRecovery: h.genKeys,
  toBase64: () => 'b64',
}));

import { SignupForm } from './SignupForm';

const goodKeys = {
  publicKey: new Uint8Array(),
  encryptedPrivateKey: new Uint8Array(),
  encryptedPrivKeyNonce: new Uint8Array(),
  kdfSalt: new Uint8Array(),
  recoveryProof: 'proof',
  encryptedPrivKeyRecovery: new Uint8Array(),
  recoveryPrivKeyNonce: new Uint8Array(),
  recoveryKdfSalt: new Uint8Array(),
  recoveryCode: 'MY-RECOVERY-CODE',
};

beforeEach(() => {
  vi.clearAllMocks();
});

function getInputs(container: HTMLElement) {
  return {
    name: container.querySelector('input[type=text]:not([readonly])')!,
    passwords: Array.from(container.querySelectorAll('input[type=password]')) as HTMLInputElement[],
  };
}

async function fillValid(container: HTMLElement, password: string, passphrase: string, confirm = passphrase) {
  const user = userEvent.setup();
  const { name, passwords } = getInputs(container);
  await user.type(name, 'Alice');
  await user.type(passwords[0], password); // login password
  await user.type(passwords[1], passphrase); // vault passphrase
  await user.type(passwords[2], confirm); // confirm
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  return user;
}

describe('SignupForm', () => {
  it('rejects a passphrase shorter than 12 chars', async () => {
    const { container } = render(<SignupForm token="tkn" invitedEmail="a@b.com" />);
    await fillValid(container, 'loginpass1234', 'short', 'short');
    expect(await screen.findByText(/passphrase must be at least 12/)).toBeInTheDocument();
    expect(h.signup).not.toHaveBeenCalled();
  });

  it('rejects mismatched passphrases', async () => {
    const { container } = render(<SignupForm token="tkn" invitedEmail="a@b.com" />);
    await fillValid(container, 'loginpass1234', 'passphrase12chars', 'passphrase12different');
    expect(await screen.findByText('The passphrases do not match')).toBeInTheDocument();
  });

  it('rejects a login password shorter than 12 chars', async () => {
    const { container } = render(<SignupForm token="tkn" invitedEmail="a@b.com" />);
    await fillValid(container, 'short', 'passphrase12chars');
    expect(await screen.findByText(/login password must be at least 12/)).toBeInTheDocument();
  });

  it('rejects when login password equals the passphrase', async () => {
    const { container } = render(<SignupForm token="tkn" invitedEmail="a@b.com" />);
    await fillValid(container, 'samevalue1234', 'samevalue1234');
    expect(await screen.findByText(/must be different/)).toBeInTheDocument();
  });

  it('registers, shows the recovery code, and continues to login', async () => {
    h.genKeys.mockReturnValue(goodKeys);
    h.signup.mockResolvedValue({ ok: true });
    const { container } = render(<SignupForm token="tkn" invitedEmail="a@b.com" />);
    const user = await fillValid(container, 'loginpass1234', 'passphrase12chars');
    expect(await screen.findByText('MY-RECOVERY-CODE')).toBeInTheDocument();
    await waitFor(() => expect(h.signup).toHaveBeenCalledWith(expect.objectContaining({ token: 'tkn', email: 'a@b.com', name: 'Alice' })));
    const clip = vi.spyOn(navigator.clipboard, 'writeText');
    await user.click(screen.getByRole('button', { name: 'Copy code' }));
    expect(clip).toHaveBeenCalledWith('MY-RECOVERY-CODE');
    await user.click(screen.getByRole('button', { name: /continue to login/ }));
    expect(h.push).toHaveBeenCalledWith('/login?signed_up=1');
  });

  it('shows the error returned by signup', async () => {
    h.genKeys.mockReturnValue(goodKeys);
    h.signup.mockResolvedValue({ ok: false, error: 'token used' });
    const { container } = render(<SignupForm token="tkn" invitedEmail="a@b.com" />);
    await fillValid(container, 'loginpass1234', 'passphrase12chars');
    expect(await screen.findByText('token used')).toBeInTheDocument();
  });

  it('catches a key-generation failure', async () => {
    h.genKeys.mockImplementation(() => {
      throw new Error('keygen boom');
    });
    const { container } = render(<SignupForm token="tkn" invitedEmail="a@b.com" />);
    await fillValid(container, 'loginpass1234', 'passphrase12chars');
    expect(await screen.findByText('keygen boom')).toBeInTheDocument();
  });
});
