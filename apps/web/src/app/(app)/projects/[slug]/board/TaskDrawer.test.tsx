import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ push: vi.fn() }));
const nav = vi.hoisted(() => ({ params: new URLSearchParams() }));
const h = vi.hoisted(() => ({ getTaskDetailAction: vi.fn(), generateTaskImplPlanAction: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => nav.params,
}));
vi.mock('@/lib/actions/impl-plan', () => ({
  getTaskDetailAction: h.getTaskDetailAction,
  generateTaskImplPlanAction: h.generateTaskImplPlanAction,
}));

import { TaskDrawer } from './TaskDrawer';

const DETAIL = {
  id: 'task-24',
  taskNumber: 24,
  title: 'Agregar /pong',
  description: 'responder 200',
  acceptanceCriteria: 'GET /pong → 200',
  state: 'Desarrollo',
  assignee: 'Kai',
  implPlan: null as string | null,
  implPlanAt: null as string | null,
};

beforeEach(() => {
  router.push.mockReset();
  h.getTaskDetailAction.mockReset();
  h.generateTaskImplPlanAction.mockReset();
  nav.params = new URLSearchParams();
});

describe('TaskDrawer', () => {
  it('no renderiza nada sin ?task=', () => {
    render(<TaskDrawer slug="axon" canWrite />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('abre y muestra la HU con su descripción y criterios', async () => {
    nav.params = new URLSearchParams('task=task-24');
    h.getTaskDetailAction.mockResolvedValue({ ok: true, data: DETAIL });
    render(<TaskDrawer slug="axon" canWrite />);
    expect(await screen.findByText(/#24 · Agregar \/pong/)).toBeInTheDocument();
    expect(screen.getByText('responder 200')).toBeInTheDocument();
    expect(screen.getByText('GET /pong → 200')).toBeInTheDocument();
    // Sin plan → botón de generar visible.
    expect(screen.getByRole('button', { name: /Generate implementation plan/i })).toBeInTheDocument();
  });

  it('genera el plan y lo muestra con el badge Generado', async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams('task=task-24');
    h.getTaskDetailAction.mockResolvedValue({ ok: true, data: DETAIL });
    h.generateTaskImplPlanAction.mockResolvedValue({
      ok: true,
      data: { implPlan: '# Plan técnico\n1. tocar health.ts', implPlanAt: '2026-07-04T00:00:00Z' },
    });
    render(<TaskDrawer slug="axon" canWrite />);
    await screen.findByText(/#24/);
    await user.click(screen.getByRole('button', { name: /Generate implementation plan/i }));
    expect(h.generateTaskImplPlanAction).toHaveBeenCalledWith('axon', 'task-24');
    expect(await screen.findByTestId('impl-plan-content')).toHaveTextContent('tocar health.ts');
    expect(screen.getByText('Generated')).toBeInTheDocument();
  });

  it('muestra el plan existente y ofrece regenerar', async () => {
    nav.params = new URLSearchParams('task=task-24');
    h.getTaskDetailAction.mockResolvedValue({
      ok: true,
      data: { ...DETAIL, implPlan: '# Plan previo', implPlanAt: '2026-07-04T00:00:00Z' },
    });
    render(<TaskDrawer slug="axon" canWrite />);
    expect(await screen.findByTestId('impl-plan-content')).toHaveTextContent('Plan previo');
    expect(screen.getByRole('button', { name: /Regenerate plan/i })).toBeInTheDocument();
  });

  it('oculta el botón para lectores (canWrite=false)', async () => {
    nav.params = new URLSearchParams('task=task-24');
    h.getTaskDetailAction.mockResolvedValue({ ok: true, data: DETAIL });
    render(<TaskDrawer slug="axon" canWrite={false} />);
    await screen.findByText(/#24/);
    expect(screen.queryByRole('button', { name: /Generate/i })).toBeNull();
  });

  it('surface el error de generación', async () => {
    const user = userEvent.setup();
    nav.params = new URLSearchParams('task=task-24');
    h.getTaskDetailAction.mockResolvedValue({ ok: true, data: DETAIL });
    h.generateTaskImplPlanAction.mockResolvedValue({ ok: false, error: 'IA caída' });
    render(<TaskDrawer slug="axon" canWrite />);
    await screen.findByText(/#24/);
    await user.click(screen.getByRole('button', { name: /Generate implementation plan/i }));
    await waitFor(() => expect(screen.getByText('IA caída')).toBeInTheDocument());
  });
});
