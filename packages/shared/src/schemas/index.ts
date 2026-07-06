import { z } from 'zod';

// ---------- Auth ----------

export const signupSchema = z.object({
  // Invite token (registration is invite-only). Validated server-side; the
  // account email is taken from the invitation, not trusted from the client.
  token: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(12, 'Mínimo 12 caracteres'),
  publicKey: z.string().min(1), // base64url
  encryptedPrivateKey: z.string().min(1), // base64url
  encryptedPrivKeyNonce: z.string().min(1), // base64url
  kdfSalt: z.string().min(1), // base64url
  // Vault recovery (zero-knowledge): proof = sha256(code); the server never
  // sees the code itself. The recovery blob is sk_user sealed with the code.
  recoveryHash: z.string().min(1), // sha256 hex proof
  encryptedPrivKeyRecovery: z.string().min(1), // base64url
  recoveryPrivKeyNonce: z.string().min(1), // base64url
  recoveryKdfSalt: z.string().min(1), // base64url
});
export type SignupInput = z.infer<typeof signupSchema>;

// Reset the vault passphrase using the recovery code. The client decrypts the
// private key with the code, re-seals it under a NEW passphrase, and sends the
// new passphrase blob + the sha256 proof of the code (verified server-side).
export const resetPassphraseSchema = z.object({
  recoveryHash: z.string().min(1), // sha256 hex proof of the code
  encryptedPrivateKey: z.string().min(1), // base64url, re-sealed under new passphrase
  encryptedPrivKeyNonce: z.string().min(1),
  kdfSalt: z.string().min(1),
});
export type ResetPassphraseInput = z.infer<typeof resetPassphraseSchema>;

// Regenerate the recovery code (vault must be unlocked client-side). Sends a
// fresh recovery blob + its proof.
export const setRecoveryCodeSchema = z.object({
  recoveryHash: z.string().min(1),
  encryptedPrivKeyRecovery: z.string().min(1),
  recoveryPrivKeyNonce: z.string().min(1),
  recoveryKdfSalt: z.string().min(1),
});
export type SetRecoveryCodeInput = z.infer<typeof setRecoveryCodeSchema>;

// Master-user creates an invitation for an email (registration is invite-only).
export const createInvitationSchema = z.object({
  email: z.string().email(),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

// ---------- Project ----------

export const createProjectSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'Solo minúsculas, números y guiones'),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  // Dónde corren los agentes: CLOUD (worker 24/7) | LOCAL (tu Claude Code).
  runtime: z.enum(['CLOUD', 'LOCAL']).default('CLOUD'),
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const memberRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

export const senioritySchema = z.enum(['JUNIOR', 'SEMI_SENIOR', 'SENIOR']);
export type SeniorityInput = z.infer<typeof senioritySchema>;

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: memberRoleSchema,
  // Optional seniority for AI time estimation, captured at invite time.
  seniority: senioritySchema.optional(),
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

// Request a login-password reset link by email (always responds ok to avoid
// account enumeration). The vault is unaffected — see resetPasswordSchema.
export const requestPasswordResetSchema = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;

// Set a new login password from a reset token. Only updates server auth; the
// E2E vault stays protected by its own passphrase / recovery code.
export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(12, 'Mínimo 12 caracteres'),
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ---------- Task ----------

export const prioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);

export const createTaskSchema = z.object({
  parentTaskId: z.string().cuid().optional(),
  stateId: z.string().cuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  priority: prioritySchema.default('MEDIUM'),
  assigneeId: z.string().cuid().optional(),
  dueDate: z.coerce.date().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = createTaskSchema.partial().extend({
  id: z.string().cuid(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const moveTaskSchema = z.object({
  id: z.string().cuid(),
  toStateId: z.string().cuid(),
});

// ---------- Credential ----------

export const credTypeSchema = z.enum(['EMAIL_LOGIN', 'PASSWORD', 'API_KEY', 'SSH_KEY', 'NOTE', 'CERT']);

export const credentialAccessEntrySchema = z.object({
  userId: z.string().cuid(),
  wrappedDek: z.string().min(1), // base64
});

export const createCredentialSchema = z.object({
  name: z.string().min(1).max(200),
  type: credTypeSchema,
  ciphertext: z.string().min(1), // base64
  nonce: z.string().min(1), // base64
  metadataPublic: z.record(z.string()).optional(),
  access: z.array(credentialAccessEntrySchema).min(1),
});
export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;

// ---------- API tokens ----------

export const apiScopeSchema = z.enum([
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
  'skills:read',
  'skills:write',
]);

export const createApiTokenSchema = z.object({
  name: z.string().min(1).max(120),
  projectSlugs: z.array(z.string()).optional(), // empty/undefined = all user's projects
  scopes: z.array(apiScopeSchema).min(1),
  expiresAt: z.coerce.date().optional(),
});
export type CreateApiTokenInput = z.infer<typeof createApiTokenSchema>;

// ---------- AI ----------

export const aiPurposeSchema = z.enum([
  'task.draft',
  'task.summarize',
  'ac.generate',
  'epic.breakdown',
  'commit.message',
  'brain.extract',
  'pr.description',
  'bug.report',
  'story.generate',
]);

export const aiInvokeSchema = z.object({
  purpose: aiPurposeSchema,
  projectId: z.string().cuid().optional(),
  context: z.string().max(50_000),
});
export type AiInvokeInput = z.infer<typeof aiInvokeSchema>;
