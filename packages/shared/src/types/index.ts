export type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

export type StateCategory = 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'REVIEW' | 'DONE';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

export type CredType = 'EMAIL_LOGIN' | 'PASSWORD' | 'API_KEY' | 'SSH_KEY' | 'NOTE' | 'CERT';

export type AiPurpose =
  | 'task.draft'
  | 'task.summarize'
  | 'ac.generate'
  | 'epic.breakdown'
  | 'commit.message'
  | 'pr.description'
  | 'bug.report'
  | 'brain.extract'
  | 'story.generate';

export type ApiScope =
  | 'projects:read'
  | 'projects:write'
  | 'tasks:read'
  | 'tasks:write'
  | 'comments:write'
  | 'bugs:write'
  | 'brain:read'
  | 'brain:write'
  | 'stories:read'
  | 'stories:write'
  | 'repo:read'
  | 'skills:read'
  | 'skills:write'
  // Scope privilegiado del worker multi-tenant: le permite leer los tokens de
  // agente (desellados) de TODOS los proyectos vía /internal/agent-runtime.
  // NUNCA se otorga a un agente ni a un usuario normal — solo al token de
  // servicio del worker (AGENT_RUNTIME_TOKEN).
  | 'agents:runtime';

export interface DefaultWorkflowState {
  name: string;
  color: string;
  category: StateCategory;
}

export const DEFAULT_WORKFLOW_STATES: ReadonlyArray<DefaultWorkflowState> = [
  { name: 'Preparación', color: '#6b7280', category: 'OPEN' },
  { name: 'Desarrollo', color: '#3b82f6', category: 'IN_PROGRESS' },
  { name: 'Bloqueada', color: '#ef4444', category: 'BLOCKED' },
  { name: 'Verificación', color: '#f59e0b', category: 'REVIEW' },
  { name: 'Terminada', color: '#10b981', category: 'DONE' },
] as const;
