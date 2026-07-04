import { headers } from 'next/headers';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

export type AuditAction =
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'file.upload'
  | 'file.delete'
  | 'file.context.add'
  | 'file.context.remove'
  | 'file.context.generate'
  | 'member.invite'
  | 'member.invite_resend'
  | 'member.role_change'
  | 'member.remove'
  | 'project.transfer_ownership'
  | 'project.image'
  | 'credential.create'
  | 'credential.read'
  | 'credential.share'
  | 'credential.revoke'
  | 'credential.rotate'
  | 'credential.delete'
  | 'task.create'
  | 'task.update'
  | 'task.move'
  | 'task.delete'
  | 'task.qa_review'
  | 'task.qa_decision'
  | 'task.impl_plan'
  | 'task.refine'
  | 'task.design'
  | 'task.tech_design'
  | 'task.self_approval_blocked'
  | 'agent.provision'
  | 'agent.update'
  | 'auth.login'
  | 'auth.totp_enable'
  | 'auth.totp_disable'
  | 'auth.password_reset_request'
  | 'auth.password_reset'
  | 'vault.passphrase_reset'
  | 'vault.recovery_code_regenerated'
  | 'invitation.create'
  | 'invitation.revoke'
  | 'api_token.create'
  | 'api_token.revoke'
  | 'model_token.create'
  | 'ai.invoke'
  | 'brain.capture'
  | 'brain.publish'
  | 'brain.cite'
  | 'brain.supersede'
  | 'brain.deprecate'
  | 'brain.extract'
  | 'brain.pull'
  | 'story.draft.start'
  | 'story.draft.complete'
  | 'story.draft.error'
  | 'story.publish'
  | 'repo.read'
  | 'analysis.start'
  | 'deploy.connect'
  | 'deploy.env_class'
  | 'deploy.create'
  | 'deploy.redeploy'
  | 'deploy.stop'
  | 'deploy.start'
  | 'deploy.recreate'
  | 'deploy.rollback'
  | 'deploy.env'
  | 'deploy.db.create'
  | 'deploy.import'
  | 'deploy.unlink'
  | 'deploy.destroy'
  | 'llm_credential.create'
  | 'llm_credential.revoke'
  | 'skill.contribute'
  | 'skill.review'
  | 'skill.update'
  | 'skill.delete';

export interface AuditOptions {
  actorId: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  projectId?: string;
  payload?: Prisma.InputJsonValue;
}

/**
 * Record an audit log entry. Best-effort — never throws to the caller, since
 * a logging failure shouldn't break the underlying operation.
 */
export async function audit(opts: AuditOptions): Promise<void> {
  try {
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const h = await headers();
      ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
      userAgent = h.get('user-agent');
    } catch {
      // headers() may not be available in some non-request contexts (e.g.
      // when audit is invoked from a background job). Continue without.
    }

    await prisma.auditLog.create({
      data: {
        actorId: opts.actorId,
        action: opts.action,
        resourceType: opts.resourceType,
        resourceId: opts.resourceId,
        projectId: opts.projectId,
        ip,
        userAgent,
        payload: opts.payload,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] failed to record log:', err);
  }
}
