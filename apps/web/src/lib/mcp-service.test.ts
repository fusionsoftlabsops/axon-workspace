import { describe, expect, it, vi } from 'vitest';
import { MCP_SERVICE_EMAIL, ensureMcpServiceMembership } from './mcp-service';

function makeTx(serviceUser: { id: string } | null) {
  return {
    user: { findUnique: vi.fn().mockResolvedValue(serviceUser) },
    projectMember: { upsert: vi.fn().mockResolvedValue({}) },
  };
}

describe('mcp-service', () => {
  it('exposes the service user email', () => {
    expect(MCP_SERVICE_EMAIL).toBe('mcp-service@admin-data.local');
  });

  it('returns false and does not upsert when the service user is absent', async () => {
    const tx = makeTx(null);
    const result = await ensureMcpServiceMembership(tx as never, 'proj-1');
    expect(result).toBe(false);
    expect(tx.user.findUnique).toHaveBeenCalledWith({
      where: { email: MCP_SERVICE_EMAIL },
      select: { id: true },
    });
    expect(tx.projectMember.upsert).not.toHaveBeenCalled();
  });

  it('upserts a MEMBER membership and returns true when the service user exists', async () => {
    const tx = makeTx({ id: 'svc-9' });
    const result = await ensureMcpServiceMembership(tx as never, 'proj-1');
    expect(result).toBe(true);
    expect(tx.projectMember.upsert).toHaveBeenCalledWith({
      where: { projectId_userId: { projectId: 'proj-1', userId: 'svc-9' } },
      update: {},
      create: { projectId: 'proj-1', userId: 'svc-9', role: 'MEMBER' },
    });
  });
});
