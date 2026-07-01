import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  createSkillAction: vi.fn(),
  reviewSkillAction: vi.fn(),
  deleteSkillAction: vi.fn(),
}));
vi.mock('@/lib/actions/skills', () => ({
  createSkillAction: h.createSkillAction,
  reviewSkillAction: h.reviewSkillAction,
  deleteSkillAction: h.deleteSkillAction,
}));

import { SkillsClient } from './SkillsClient';
import type { SkillView } from '@/lib/actions/skills';

const skill = (over: Partial<SkillView> = {}): SkillView => ({
  id: 's1',
  slug: 'cerrar-hu',
  name: 'Cerrar HU',
  description: 'Cierra la HU',
  category: 'WORKFLOW',
  kind: 'COMMAND',
  body: '# /cerrar-hu',
  official: true,
  status: 'APPROVED',
  version: 1,
  tags: ['qa'],
  authorName: null,
  updatedAt: '',
  ...over,
});

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe('SkillsClient', () => {
  it('lists approved skills with the official badge and install docs', () => {
    render(<SkillsClient initialSkills={[skill()]} isMaster={false} />);
    expect(screen.getByText('Cerrar HU')).toBeInTheDocument();
    expect(screen.getByText('/skills sync')).toBeInTheDocument();
    expect(screen.getByText(/Official/i)).toBeInTheDocument();
  });

  it('hides pending community skills from non-masters', () => {
    render(<SkillsClient initialSkills={[skill({ id: 's2', slug: 'wip', name: 'WIP', status: 'PENDING', official: false })]} isMaster={false} />);
    expect(screen.queryByText('WIP')).toBeNull();
    expect(screen.getByText(/No skills yet/i)).toBeInTheDocument();
  });

  it('shows pending skills + admin actions to masters', () => {
    render(<SkillsClient initialSkills={[skill({ id: 's2', slug: 'wip', name: 'WIP', status: 'PENDING', official: false })]} isMaster />);
    expect(screen.getByText('WIP')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
  });

  it('contributes a skill via the form', async () => {
    const user = userEvent.setup();
    h.createSkillAction.mockResolvedValue({ ok: true, data: skill({ id: 's3', slug: 'nuevo', name: 'Nuevo', status: 'PENDING', official: false }) });
    render(<SkillsClient initialSkills={[]} isMaster={false} />);
    await user.click(screen.getByRole('button', { name: /Contribute a skill/i }));
    await user.type(screen.getByPlaceholderText('mi-skill'), 'nuevo');
    // fill required text inputs (name, description) + body
    const inputs = screen.getAllByRole('textbox');
    // inputs: slug, name, description, tags, body(textarea)
    await user.type(inputs[1]!, 'Nuevo');
    await user.type(inputs[2]!, 'hace algo');
    await user.type(inputs[4]!, '# contenido');
    await user.click(screen.getByRole('button', { name: /Submit for review/i }));
    expect(h.createSkillAction).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'nuevo', name: 'Nuevo', body: '# contenido' }),
    );
    // Contributed skill is PENDING → a non-master doesn't see it; the form closes.
    expect(await screen.findByRole('button', { name: /Contribute a skill/i })).toBeInTheDocument();
  });

  it('approves a skill as master', async () => {
    const user = userEvent.setup();
    h.reviewSkillAction.mockResolvedValue({ ok: true, data: skill({ id: 's2', slug: 'wip', name: 'WIP', status: 'APPROVED', official: false }) });
    render(<SkillsClient initialSkills={[skill({ id: 's2', slug: 'wip', name: 'WIP', status: 'PENDING', official: false })]} isMaster />);
    await user.click(screen.getByRole('button', { name: /Approve/i }));
    expect(h.reviewSkillAction).toHaveBeenCalledWith('s2', { status: 'APPROVED' });
  });
});
