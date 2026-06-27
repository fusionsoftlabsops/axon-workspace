import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
const h = vi.hoisted(() => ({
  planChatAction: vi.fn(),
  startPlanGenerationAction: vi.fn(),
  publishPlanAction: vi.fn(),
  addPlanLinkAction: vi.fn(),
  removePlanAttachmentAction: vi.fn(),
  reestimatePlanAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock('./PlanRepos', () => ({ PlanRepos: () => <div>planrepos</div> }));
vi.mock('./AnalysisPanel', () => ({ AnalysisPanel: () => <div>analysispanel</div> }));
vi.mock('./PlanEditors', () => ({
  PlanSprintHead: ({ sprintIndex, onToggle }: any) => (
    <button onClick={onToggle}>toggle-{sprintIndex}</button>
  ),
  PlanTaskCard: ({ task }: any) => <div>taskcard:{task.title}</div>,
}));
vi.mock('@/lib/actions/planning', () => ({
  planChatAction: h.planChatAction,
  startPlanGenerationAction: h.startPlanGenerationAction,
  publishPlanAction: h.publishPlanAction,
  addPlanLinkAction: h.addPlanLinkAction,
  removePlanAttachmentAction: h.removePlanAttachmentAction,
  reestimatePlanAction: h.reestimatePlanAction,
}));

import { PlanChat } from './PlanChat';

function genPlan(over: Record<string, unknown> = {}) {
  return {
    improvedIdea: 'A better idea',
    suggestedRepos: [{ name: 'api' }],
    sprints: [
      {
        name: 'S1',
        goal: 'goal',
        tasks: [{ title: 'T1' }],
      },
    ],
    ...over,
  };
}

function plan(over: Record<string, unknown> = {}) {
  return {
    status: 'READY',
    generated: null,
    improvedIdea: null,
    error: null,
    messages: [{ role: 'assistant', content: 'Hi there' }],
    attachments: [],
    ...over,
  } as never;
}

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
  Object.values(h).forEach((fn) => fn.mockReset());
  vi.stubGlobal('fetch', vi.fn());
  (Element.prototype as unknown as { scrollTo: unknown }).scrollTo = vi.fn();
});

describe('PlanChat', () => {
  it('renders messages and the composer', () => {
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    expect(screen.getByText('Hi there')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type your answer/i)).toBeInTheDocument();
  });

  it('sends a chat message and renders the assistant reply', async () => {
    const user = userEvent.setup();
    h.planChatAction.mockResolvedValue({
      ok: true,
      data: plan({ messages: [{ role: 'assistant', content: 'reply!' }] }),
    });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    await user.type(screen.getByPlaceholderText(/Type your answer/i), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(h.planChatAction).toHaveBeenCalledWith('p', 'hello');
    expect(await screen.findByText('reply!')).toBeInTheDocument();
  });

  it('sends on Enter key and surfaces an error', async () => {
    const user = userEvent.setup();
    h.planChatAction.mockResolvedValue({ ok: false, error: 'send failed' });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    const ta = screen.getByPlaceholderText(/Type your answer/i);
    await user.type(ta, 'hey{Enter}');
    expect(h.planChatAction).toHaveBeenCalledWith('p', 'hey');
    expect(await screen.findByText('send failed')).toBeInTheDocument();
  });

  it('starts plan generation and shows the generating preview', async () => {
    const user = userEvent.setup();
    h.startPlanGenerationAction.mockResolvedValue({ ok: true });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    await user.click(screen.getByRole('button', { name: /Generate plan/i }));
    expect(h.startPlanGenerationAction).toHaveBeenCalledWith('p');
    expect(await screen.findByText(/Generating the plan with Claude Opus/i)).toBeInTheDocument();
  });

  it('shows an error when generation fails to start', async () => {
    const user = userEvent.setup();
    h.startPlanGenerationAction.mockResolvedValue({ ok: false, error: 'gen failed' });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    await user.click(screen.getByRole('button', { name: /Generate plan/i }));
    expect(await screen.findByText('gen failed')).toBeInTheDocument();
  });

  it('polls while generating and transitions to READY with the generated preview', async () => {
    vi.useFakeTimers();
    (globalThis.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ plan: { status: 'READY', generated: genPlan(), improvedIdea: 'better' } }),
    });
    render(<PlanChat slug="p" canWrite initialPlan={plan({ status: 'GENERATING' })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText('A better idea')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('redirects to login when polling returns 401', async () => {
    vi.useFakeTimers();
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { writable: true, value: { assign, origin: 'http://x' } });
    (globalThis.fetch as any).mockResolvedValue({ status: 401, json: async () => ({}) });
    render(<PlanChat slug="p" canWrite initialPlan={plan({ status: 'GENERATING' })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(assign).toHaveBeenCalledWith('/login');
    vi.useRealTimers();
  });

  it('keeps polling when the fetch throws', async () => {
    vi.useFakeTimers();
    (globalThis.fetch as any).mockRejectedValue(new Error('network'));
    render(<PlanChat slug="p" canWrite initialPlan={plan({ status: 'GENERATING' })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText(/Generating the plan/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('shows a FAILED status error from polling', async () => {
    vi.useFakeTimers();
    (globalThis.fetch as any).mockResolvedValue({
      status: 200,
      json: async () => ({ plan: { status: 'FAILED', error: 'boom' } }),
    });
    render(<PlanChat slug="p" canWrite initialPlan={plan({ status: 'GENERATING' })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(screen.getByText('boom')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders the published banner and hides the composer', () => {
    render(<PlanChat slug="p" canWrite initialPlan={plan({ status: 'PUBLISHED' })} />);
    expect(screen.getByText(/Plan published to the board/i)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Type your answer/i)).toBeNull();
  });

  it('renders the generated preview, toggles a sprint and shows task cards', async () => {
    const user = userEvent.setup();
    render(
      <PlanChat
        slug="p"
        canWrite
        initialPlan={plan({ status: 'READY', generated: genPlan(), improvedIdea: 'x' })}
      />,
    );
    expect(screen.getByText('A better idea')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'toggle-0' }));
    expect(await screen.findByText('taskcard:T1')).toBeInTheDocument();
  });

  it('reestimates the plan from the preview', async () => {
    const user = userEvent.setup();
    h.reestimatePlanAction.mockResolvedValue({ ok: true, data: plan({ status: 'READY', generated: genPlan() }) });
    render(
      <PlanChat
        slug="p"
        canWrite
        initialPlan={plan({ status: 'READY', generated: genPlan() })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Recompute estimates/i }));
    expect(h.reestimatePlanAction).toHaveBeenCalledWith('p');
  });

  it('publishes the plan and navigates to the roadmap', async () => {
    const user = userEvent.setup();
    h.publishPlanAction.mockResolvedValue({ ok: true });
    render(
      <PlanChat slug="p" canWrite initialPlan={plan({ status: 'READY', generated: genPlan() })} />,
    );
    await user.click(screen.getByRole('button', { name: /Publish to board/i }));
    expect(h.publishPlanAction).toHaveBeenCalledWith('p');
    expect(router.push).toHaveBeenCalledWith('/projects/p/roadmap');
  });

  it('shows an error when publishing fails', async () => {
    const user = userEvent.setup();
    h.publishPlanAction.mockResolvedValue({ ok: false, error: 'pub failed' });
    render(
      <PlanChat slug="p" canWrite initialPlan={plan({ status: 'READY', generated: genPlan() })} />,
    );
    await user.click(screen.getByRole('button', { name: /Publish to board/i }));
    expect(await screen.findByText('pub failed')).toBeInTheDocument();
  });

  it('renders attachments with icons and removes one', async () => {
    const user = userEvent.setup();
    h.removePlanAttachmentAction.mockResolvedValue({ ok: true, data: plan({ attachments: [] }) });
    render(
      <PlanChat
        slug="p"
        canWrite
        initialPlan={plan({
          attachments: [
            { id: 'a1', name: 'pic', url: 'http://x/p', kind: 'IMAGE' },
            { id: 'a2', name: 'link', url: 'http://x/l', kind: 'LINK' },
            { id: 'a3', name: 'doc', url: null, kind: 'FILE' },
          ],
        })}
      />,
    );
    expect(screen.getByText('pic')).toBeInTheDocument();
    expect(screen.getByText('doc')).toBeInTheDocument();
    const list = screen.getByRole('list');
    await user.click(within(list).getAllByRole('button', { name: 'Remove' })[0]);
    expect(h.removePlanAttachmentAction).toHaveBeenCalledWith('p', 'a1');
  });

  it('adds a link attachment', async () => {
    const user = userEvent.setup();
    h.addPlanLinkAction.mockResolvedValue({ ok: true, data: plan() });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    await user.type(screen.getByPlaceholderText(/Paste a link/i), 'https://x.com');
    await user.click(screen.getByRole('button', { name: 'Add link' }));
    expect(h.addPlanLinkAction).toHaveBeenCalledWith('p', 'https://x.com');
  });

  it('uploads files via the hidden file input', async () => {
    const user = userEvent.setup();
    (globalThis.fetch as any)
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
      .mockResolvedValueOnce({ json: async () => ({ plan: { attachments: [{ id: 'n1', name: 'up', kind: 'FILE' }] } }) });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['data'], 'up.png', { type: 'image/png' });
    await user.upload(input, file);
    expect(await screen.findByText('up')).toBeInTheDocument();
  });

  it('shows an error when file upload fails', async () => {
    const user = userEvent.setup();
    (globalThis.fetch as any).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'too big' }) });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['d'], 'x.png', { type: 'image/png' }));
    expect(await screen.findByText('too big')).toBeInTheDocument();
  });

  it('hides write controls for viewers', () => {
    render(<PlanChat slug="p" canWrite={false} initialPlan={plan()} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Generate plan/i })).toBeNull();
    expect(screen.getByText(/Skip to board/i)).toBeInTheDocument();
  });
});
