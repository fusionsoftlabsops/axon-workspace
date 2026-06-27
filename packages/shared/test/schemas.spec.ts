import { describe, it, expect } from 'vitest';
import {
  signupSchema,
  resetPassphraseSchema,
  setRecoveryCodeSchema,
  createInvitationSchema,
  loginSchema,
  createProjectSchema,
  memberRoleSchema,
  inviteMemberSchema,
  prioritySchema,
  createTaskSchema,
  updateTaskSchema,
  moveTaskSchema,
  credTypeSchema,
  credentialAccessEntrySchema,
  createCredentialSchema,
  apiScopeSchema,
  createApiTokenSchema,
  aiPurposeSchema,
  aiInvokeSchema,
} from '../src/schemas';

// A valid cuid-looking id (zod's .cuid() expects c + 24 chars).
const CUID = 'cjld2cjxh0000qzrmn831i7rn';
const CUID2 = 'cjld2cyuq0000t3rmniod1foy';

describe('signupSchema', () => {
  const valid = {
    token: 'invite-token',
    email: 'user@example.com',
    name: 'Jane Doe',
    password: 'supersecret123', // 14 chars >= 12
    publicKey: 'pk',
    encryptedPrivateKey: 'epk',
    encryptedPrivKeyNonce: 'nonce',
    kdfSalt: 'salt',
    recoveryHash: 'hash',
    encryptedPrivKeyRecovery: 'epkr',
    recoveryPrivKeyNonce: 'rnonce',
    recoveryKdfSalt: 'rsalt',
  };

  it('accepts a fully valid signup payload', () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects empty token', () => {
    expect(signupSchema.safeParse({ ...valid, token: '' }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(signupSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
  });

  it('rejects empty name and over-long name', () => {
    expect(signupSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, name: 'x'.repeat(121) }).success).toBe(false);
  });

  it('rejects password shorter than 12 chars', () => {
    expect(signupSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    // exactly 12 is allowed
    expect(signupSchema.safeParse({ ...valid, password: 'a'.repeat(12) }).success).toBe(true);
  });

  it('rejects empty crypto / recovery fields', () => {
    for (const key of [
      'publicKey',
      'encryptedPrivateKey',
      'encryptedPrivKeyNonce',
      'kdfSalt',
      'recoveryHash',
      'encryptedPrivKeyRecovery',
      'recoveryPrivKeyNonce',
      'recoveryKdfSalt',
    ] as const) {
      expect(signupSchema.safeParse({ ...valid, [key]: '' }).success).toBe(false);
    }
  });

  it('rejects a missing required field', () => {
    const { kdfSalt, ...withoutSalt } = valid;
    expect(signupSchema.safeParse(withoutSalt).success).toBe(false);
  });
});

describe('resetPassphraseSchema', () => {
  const valid = {
    recoveryHash: 'hash',
    encryptedPrivateKey: 'epk',
    encryptedPrivKeyNonce: 'nonce',
    kdfSalt: 'salt',
  };
  it('accepts a valid payload', () => {
    expect(resetPassphraseSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects empty fields', () => {
    for (const key of Object.keys(valid) as (keyof typeof valid)[]) {
      expect(resetPassphraseSchema.safeParse({ ...valid, [key]: '' }).success).toBe(false);
    }
  });
});

describe('setRecoveryCodeSchema', () => {
  const valid = {
    recoveryHash: 'hash',
    encryptedPrivKeyRecovery: 'epkr',
    recoveryPrivKeyNonce: 'nonce',
    recoveryKdfSalt: 'salt',
  };
  it('accepts a valid payload', () => {
    expect(setRecoveryCodeSchema.safeParse(valid).success).toBe(true);
  });
  it('rejects empty fields', () => {
    expect(setRecoveryCodeSchema.safeParse({ ...valid, recoveryHash: '' }).success).toBe(false);
  });
});

describe('createInvitationSchema', () => {
  it('accepts a valid email', () => {
    expect(createInvitationSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });
  it('rejects an invalid email', () => {
    expect(createInvitationSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });
});

describe('loginSchema', () => {
  it('accepts email + password without totp', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x' }).success).toBe(true);
  });
  it('accepts a valid 6-digit totp', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', totp: '123456' }).success).toBe(true);
  });
  it('rejects empty password', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: '' }).success).toBe(false);
  });
  it('rejects invalid email', () => {
    expect(loginSchema.safeParse({ email: 'x', password: 'x' }).success).toBe(false);
  });
  it('rejects malformed totp (wrong length / non-digits)', () => {
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', totp: '12345' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', totp: '1234567' }).success).toBe(false);
    expect(loginSchema.safeParse({ email: 'a@b.com', password: 'x', totp: 'abcdef' }).success).toBe(false);
  });
});

describe('createProjectSchema', () => {
  const valid = { slug: 'my-project', name: 'My Project', description: 'desc' };
  it('accepts a valid project (with optional description)', () => {
    expect(createProjectSchema.safeParse(valid).success).toBe(true);
  });
  it('accepts without description', () => {
    expect(createProjectSchema.safeParse({ slug: 'ab', name: 'n' }).success).toBe(true);
  });
  it('rejects slug too short / too long', () => {
    expect(createProjectSchema.safeParse({ ...valid, slug: 'a' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...valid, slug: 'a'.repeat(41) }).success).toBe(false);
  });
  it('rejects slug with invalid characters / leading-trailing hyphen / uppercase', () => {
    expect(createProjectSchema.safeParse({ ...valid, slug: '-abc' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...valid, slug: 'abc-' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...valid, slug: 'Abc' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...valid, slug: 'a b' }).success).toBe(false);
  });
  it('accepts a valid numeric/hyphen slug', () => {
    expect(createProjectSchema.safeParse({ ...valid, slug: 'a1-b2' }).success).toBe(true);
  });
  it('rejects empty name and over-long name', () => {
    expect(createProjectSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(createProjectSchema.safeParse({ ...valid, name: 'x'.repeat(121) }).success).toBe(false);
  });
  it('rejects over-long description', () => {
    expect(createProjectSchema.safeParse({ ...valid, description: 'x'.repeat(2001) }).success).toBe(false);
  });
});

describe('memberRoleSchema', () => {
  it('accepts each valid role', () => {
    for (const r of ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']) {
      expect(memberRoleSchema.safeParse(r).success).toBe(true);
    }
  });
  it('rejects an unknown role', () => {
    expect(memberRoleSchema.safeParse('GUEST').success).toBe(false);
  });
});

describe('inviteMemberSchema', () => {
  it('accepts a valid email + role', () => {
    expect(inviteMemberSchema.safeParse({ email: 'a@b.com', role: 'ADMIN' }).success).toBe(true);
  });
  it('rejects an invalid role', () => {
    expect(inviteMemberSchema.safeParse({ email: 'a@b.com', role: 'BOSS' }).success).toBe(false);
  });
  it('rejects an invalid email', () => {
    expect(inviteMemberSchema.safeParse({ email: 'x', role: 'ADMIN' }).success).toBe(false);
  });
});

describe('prioritySchema', () => {
  it('accepts each valid priority', () => {
    for (const p of ['LOW', 'MEDIUM', 'HIGH', 'URGENT']) {
      expect(prioritySchema.safeParse(p).success).toBe(true);
    }
  });
  it('rejects an unknown priority', () => {
    expect(prioritySchema.safeParse('CRITICAL').success).toBe(false);
  });
});

describe('createTaskSchema', () => {
  const valid = { stateId: CUID, title: 'Do the thing' };

  it('accepts a minimal valid task and applies the MEDIUM priority default', () => {
    const res = createTaskSchema.safeParse(valid);
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.priority).toBe('MEDIUM');
  });

  it('accepts a full valid task with optional fields', () => {
    const res = createTaskSchema.safeParse({
      ...valid,
      parentTaskId: CUID2,
      description: 'details',
      priority: 'HIGH',
      assigneeId: CUID2,
      dueDate: '2026-01-01T00:00:00.000Z',
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.priority).toBe('HIGH');
      expect(res.data.dueDate).toBeInstanceOf(Date);
    }
  });

  it('coerces a date string into a Date', () => {
    const res = createTaskSchema.safeParse({ ...valid, dueDate: '2026-06-27' });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.dueDate).toBeInstanceOf(Date);
  });

  it('rejects a non-cuid stateId', () => {
    expect(createTaskSchema.safeParse({ ...valid, stateId: 'not-a-cuid' }).success).toBe(false);
  });
  it('rejects a non-cuid parentTaskId / assigneeId', () => {
    expect(createTaskSchema.safeParse({ ...valid, parentTaskId: 'x' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...valid, assigneeId: 'x' }).success).toBe(false);
  });
  it('rejects empty / over-long title', () => {
    expect(createTaskSchema.safeParse({ ...valid, title: '' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ ...valid, title: 'x'.repeat(201) }).success).toBe(false);
  });
  it('rejects over-long description', () => {
    expect(createTaskSchema.safeParse({ ...valid, description: 'x'.repeat(20_001) }).success).toBe(false);
  });
  it('rejects an invalid priority', () => {
    expect(createTaskSchema.safeParse({ ...valid, priority: 'NOPE' }).success).toBe(false);
  });
  it('rejects an invalid date', () => {
    expect(createTaskSchema.safeParse({ ...valid, dueDate: 'not-a-date' }).success).toBe(false);
  });
  it('rejects a missing stateId', () => {
    expect(createTaskSchema.safeParse({ title: 'x' }).success).toBe(false);
  });
});

describe('updateTaskSchema', () => {
  it('accepts an id-only update (all other fields optional via partial)', () => {
    expect(updateTaskSchema.safeParse({ id: CUID }).success).toBe(true);
  });
  it('accepts an id plus some partial fields', () => {
    expect(updateTaskSchema.safeParse({ id: CUID, title: 'new', priority: 'URGENT' }).success).toBe(true);
  });
  it('rejects a missing id', () => {
    expect(updateTaskSchema.safeParse({ title: 'new' }).success).toBe(false);
  });
  it('rejects a non-cuid id', () => {
    expect(updateTaskSchema.safeParse({ id: 'nope' }).success).toBe(false);
  });
  it('still validates the inherited field constraints', () => {
    expect(updateTaskSchema.safeParse({ id: CUID, title: '' }).success).toBe(false);
  });
});

describe('moveTaskSchema', () => {
  it('accepts two valid cuids', () => {
    expect(moveTaskSchema.safeParse({ id: CUID, toStateId: CUID2 }).success).toBe(true);
  });
  it('rejects a non-cuid', () => {
    expect(moveTaskSchema.safeParse({ id: CUID, toStateId: 'x' }).success).toBe(false);
  });
  it('rejects a missing field', () => {
    expect(moveTaskSchema.safeParse({ id: CUID }).success).toBe(false);
  });
});

describe('credTypeSchema', () => {
  it('accepts each valid cred type', () => {
    for (const t of ['EMAIL_LOGIN', 'PASSWORD', 'API_KEY', 'SSH_KEY', 'NOTE', 'CERT']) {
      expect(credTypeSchema.safeParse(t).success).toBe(true);
    }
  });
  it('rejects an unknown cred type', () => {
    expect(credTypeSchema.safeParse('TOTP').success).toBe(false);
  });
});

describe('credentialAccessEntrySchema', () => {
  it('accepts a valid access entry', () => {
    expect(credentialAccessEntrySchema.safeParse({ userId: CUID, wrappedDek: 'dek' }).success).toBe(true);
  });
  it('rejects a non-cuid userId', () => {
    expect(credentialAccessEntrySchema.safeParse({ userId: 'x', wrappedDek: 'dek' }).success).toBe(false);
  });
  it('rejects an empty wrappedDek', () => {
    expect(credentialAccessEntrySchema.safeParse({ userId: CUID, wrappedDek: '' }).success).toBe(false);
  });
});

describe('createCredentialSchema', () => {
  const valid = {
    name: 'My secret',
    type: 'PASSWORD',
    ciphertext: 'ct',
    nonce: 'n',
    access: [{ userId: CUID, wrappedDek: 'dek' }],
  };
  it('accepts a valid credential', () => {
    expect(createCredentialSchema.safeParse(valid).success).toBe(true);
  });
  it('accepts an optional public metadata record of strings', () => {
    expect(createCredentialSchema.safeParse({ ...valid, metadataPublic: { url: 'https://x' } }).success).toBe(true);
  });
  it('rejects a non-string metadata value', () => {
    expect(createCredentialSchema.safeParse({ ...valid, metadataPublic: { n: 1 } }).success).toBe(false);
  });
  it('rejects an empty access array', () => {
    expect(createCredentialSchema.safeParse({ ...valid, access: [] }).success).toBe(false);
  });
  it('rejects an invalid access entry inside the array', () => {
    expect(
      createCredentialSchema.safeParse({ ...valid, access: [{ userId: 'x', wrappedDek: 'd' }] }).success,
    ).toBe(false);
  });
  it('rejects empty name / ciphertext / nonce and invalid type', () => {
    expect(createCredentialSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(createCredentialSchema.safeParse({ ...valid, ciphertext: '' }).success).toBe(false);
    expect(createCredentialSchema.safeParse({ ...valid, nonce: '' }).success).toBe(false);
    expect(createCredentialSchema.safeParse({ ...valid, type: 'WAT' }).success).toBe(false);
  });
  it('rejects an over-long name', () => {
    expect(createCredentialSchema.safeParse({ ...valid, name: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('apiScopeSchema', () => {
  it('accepts each valid scope', () => {
    for (const s of [
      'projects:read',
      'projects:write',
      'tasks:read',
      'tasks:write',
      'comments:write',
      'bugs:write',
      'brain:read',
      'brain:write',
      'stories:read',
      'stories:write',
      'repo:read',
    ]) {
      expect(apiScopeSchema.safeParse(s).success).toBe(true);
    }
  });
  it('rejects an unknown scope', () => {
    expect(apiScopeSchema.safeParse('admin:all').success).toBe(false);
  });
});

describe('createApiTokenSchema', () => {
  const valid = { name: 'CI token', scopes: ['tasks:read'] };
  it('accepts a minimal valid token', () => {
    expect(createApiTokenSchema.safeParse(valid).success).toBe(true);
  });
  it('accepts optional projectSlugs and expiresAt', () => {
    const res = createApiTokenSchema.safeParse({
      ...valid,
      projectSlugs: ['proj-a', 'proj-b'],
      expiresAt: '2027-01-01',
    });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.expiresAt).toBeInstanceOf(Date);
  });
  it('rejects an empty scopes array', () => {
    expect(createApiTokenSchema.safeParse({ ...valid, scopes: [] }).success).toBe(false);
  });
  it('rejects an invalid scope', () => {
    expect(createApiTokenSchema.safeParse({ ...valid, scopes: ['nope'] }).success).toBe(false);
  });
  it('rejects empty / over-long name', () => {
    expect(createApiTokenSchema.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(createApiTokenSchema.safeParse({ ...valid, name: 'x'.repeat(121) }).success).toBe(false);
  });
  it('rejects an invalid expiresAt', () => {
    expect(createApiTokenSchema.safeParse({ ...valid, expiresAt: 'not-a-date' }).success).toBe(false);
  });
});

describe('aiPurposeSchema', () => {
  it('accepts each valid purpose', () => {
    for (const p of [
      'task.draft',
      'task.summarize',
      'ac.generate',
      'epic.breakdown',
      'commit.message',
      'brain.extract',
      'pr.description',
      'bug.report',
      'story.generate',
    ]) {
      expect(aiPurposeSchema.safeParse(p).success).toBe(true);
    }
  });
  it('rejects an unknown purpose', () => {
    expect(aiPurposeSchema.safeParse('task.delete').success).toBe(false);
  });
});

describe('aiInvokeSchema', () => {
  const valid = { purpose: 'task.draft', context: 'some context' };
  it('accepts a valid invoke without projectId', () => {
    expect(aiInvokeSchema.safeParse(valid).success).toBe(true);
  });
  it('accepts an optional cuid projectId', () => {
    expect(aiInvokeSchema.safeParse({ ...valid, projectId: CUID }).success).toBe(true);
  });
  it('accepts an empty context (no min) and rejects over-long context', () => {
    expect(aiInvokeSchema.safeParse({ ...valid, context: '' }).success).toBe(true);
    expect(aiInvokeSchema.safeParse({ ...valid, context: 'x'.repeat(50_001) }).success).toBe(false);
  });
  it('rejects an invalid purpose', () => {
    expect(aiInvokeSchema.safeParse({ ...valid, purpose: 'nope' }).success).toBe(false);
  });
  it('rejects a non-cuid projectId', () => {
    expect(aiInvokeSchema.safeParse({ ...valid, projectId: 'x' }).success).toBe(false);
  });
});
