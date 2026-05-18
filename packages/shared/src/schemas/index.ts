import { z } from 'zod';

// ---------- Auth ----------

export const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(12, 'Mínimo 12 caracteres'),
  publicKey: z.string().min(1), // base64url
  encryptedPrivateKey: z.string().min(1), // base64url
  encryptedPrivKeyNonce: z.string().min(1), // base64url
  kdfSalt: z.string().min(1), // base64url
});
export type SignupInput = z.infer<typeof signupSchema>;

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
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const memberRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']);

export const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: memberRoleSchema,
});
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

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
