import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ generateQaTestsAction: vi.fn(), qaDecisionAction: vi.fn() }));
vi.mock('@/lib/actions/qa', () => ({
  generateQaTestsAction: h.generateQaTestsAction,
  qaDecisionAction: h.qaDecisionAction,
}));
vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));

import { QaClient } from './QaClient';
import type { QaTaskView } from '@/lib/actions/qa';

const task = (over: Partial<QaTaskView> = {}): QaTaskView => ({
  id: 't1',
  taskNumber: 3,
  title: 'Login',
  description: 'desc',
  acceptanceCriteria: 'AC text',
  assignee: { id: 'u2', name: 'Ana' },
  handoff: {
    criteria: [{ text: 'valida credenciales', met: true }],
    suggestedTests: [{ title: 'Login OK', steps: '1..', expected: 'entra' }],
    executedTasks: ['Formulario'],
    notes: 'contexto',
    submittedAt: '',
  },
  qaTests: null,
  commentCount: 2,
  ...over,
});

beforeEach(() => {
  h.generateQaTestsAction.mockReset();
  h.qaDecisionAction.mockReset();
});

describe('QaClient', () => {
  it('shows an empty state with no tasks', () => {
    render(<QaClient slug="p" canWrite initialQueue={[]} />);
    expect(screen.getByText(/No stories in Verification/i)).toBeInTheDocument();
  });

  it('lists a task and reveals handoff + criteria on expand', async () => {
    const user = userEvent.setup();
    render(<QaClient slug="p" canWrite initialQueue={[task()]} />);
    expect(screen.getByText('Login')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Login/ }));
    expect(screen.getByText('AC text')).toBeInTheDocument();
    expect(screen.getByText('Login OK')).toBeInTheDocument(); // suggested test from dev
    expect(screen.getByText(/valida credenciales/)).toBeInTheDocument();
  });

  it('generates QA tests and shows them', async () => {
    const user = userEvent.setup();
    h.generateQaTestsAction.mockResolvedValue({
      ok: true,
      data: task({ qaTests: { tests: [{ title: 'Caso QA generado' }], generatedAt: '' } }),
    });
    render(<QaClient slug="p" canWrite initialQueue={[task()]} />);
    await user.click(screen.getByRole('button', { name: /Login/ }));
    await user.click(screen.getByRole('button', { name: /Generate QA tests/i }));
    expect(h.generateQaTestsAction).toHaveBeenCalledWith('p', 't1');
    expect(await screen.findByText('Caso QA generado')).toBeInTheDocument();
  });

  it('requires a reason to reject', async () => {
    const user = userEvent.setup();
    render(<QaClient slug="p" canWrite initialQueue={[task()]} />);
    await user.click(screen.getByRole('button', { name: /Login/ }));
    await user.click(screen.getByRole('button', { name: /Reject/i }));
    expect(h.qaDecisionAction).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter a reason/i)).toBeInTheDocument();
  });

  it('approves and removes the task from the queue', async () => {
    const user = userEvent.setup();
    h.qaDecisionAction.mockResolvedValue({ ok: true });
    render(<QaClient slug="p" canWrite initialQueue={[task()]} />);
    await user.click(screen.getByRole('button', { name: /Login/ }));
    await user.click(screen.getByRole('button', { name: /Approve/i }));
    expect(h.qaDecisionAction).toHaveBeenCalledWith('p', 't1', 'approve', undefined);
    expect(await screen.findByText(/No stories in Verification/i)).toBeInTheDocument();
  });

  it('hides actions for viewers', async () => {
    const user = userEvent.setup();
    render(<QaClient slug="p" canWrite={false} initialQueue={[task()]} />);
    await user.click(screen.getByRole('button', { name: /Login/ }));
    expect(screen.queryByRole('button', { name: /Generate QA tests/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Approve/i })).toBeNull();
  });
});
