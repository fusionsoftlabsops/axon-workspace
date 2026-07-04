import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }));
const h = vi.hoisted(() => ({
  planChatAction: vi.fn(),
  planTypingAction: vi.fn(),
  clearPlanChatAction: vi.fn(),
  setChatColorAction: vi.fn(),
  startPlanGenerationAction: vi.fn(),
  publishPlanAction: vi.fn(),
  addPlanLinkAction: vi.fn(),
  removePlanAttachmentAction: vi.fn(),
  reestimatePlanAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('next/link', () => ({ default: ({ children, href }: any) => <a href={href}>{children}</a> }));
vi.mock('./PlanRepos', () => ({ PlanRepos: () => <div>planrepos</div> }));
vi.mock('./PlanContext', () => ({ PlanContext: () => <div>plancontext</div> }));
vi.mock('./PlanEditors', () => ({
  PlanSprintHead: ({ sprintIndex, onToggle }: any) => (
    <button onClick={onToggle}>toggle-{sprintIndex}</button>
  ),
  PlanTaskCard: ({ task, canGenImpl }: any) => (
    <div>
      <span>taskcard:{task.title}</span>
      {canGenImpl && <span>impl-ok:{task.title}</span>}
    </div>
  ),
}));
vi.mock('@/lib/actions/planning', () => ({
  planChatAction: h.planChatAction,
  planTypingAction: h.planTypingAction,
  clearPlanChatAction: h.clearPlanChatAction,
  setChatColorAction: h.setChatColorAction,
  startPlanGenerationAction: h.startPlanGenerationAction,
  publishPlanAction: h.publishPlanAction,
  addPlanLinkAction: h.addPlanLinkAction,
  removePlanAttachmentAction: h.removePlanAttachmentAction,
  reestimatePlanAction: h.reestimatePlanAction,
}));

// Minimal EventSource stub so the collaborative SSE effect can mount and we can
// drive typing/presence/message events in tests.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  open() {
    this.onopen?.();
  }
  emit(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  close() {
    this.closed = true;
  }
}

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
  h.planTypingAction.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', vi.fn());
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
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
    expect(await screen.findByText(/close this tab and come back/i)).toBeInTheDocument();
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
    expect(screen.getByText(/close this tab and come back/i)).toBeInTheDocument();
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
    expect(screen.getByText('impl-ok:T1')).toBeInTheDocument();
  });

  it('still allows the implementation plan after chatting past READY (status CHATTING)', async () => {
    const user = userEvent.setup();
    render(
      <PlanChat
        slug="p"
        canWrite
        initialPlan={plan({ status: 'CHATTING', generated: genPlan() })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'toggle-0' }));
    // Generated plan exists → the impl-plan affordance is available even though
    // the status is no longer READY.
    expect(await screen.findByText('impl-ok:T1')).toBeInTheDocument();
  });

  it('does not offer the implementation plan to viewers', async () => {
    const user = userEvent.setup();
    render(
      <PlanChat
        slug="p"
        canWrite={false}
        initialPlan={plan({ status: 'READY', generated: genPlan() })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'toggle-0' }));
    expect(await screen.findByText('taskcard:T1')).toBeInTheDocument();
    expect(screen.queryByText('impl-ok:T1')).toBeNull();
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
    // Hay varias listas (los tips de @menciones también son <ul>): la de adjuntos es la última.
    const list = screen.getAllByRole('list').at(-1)!;
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

  it('renders the author name on a user message', () => {
    render(
      <PlanChat
        slug="p"
        canWrite
        currentUserId="me"
        initialPlan={plan({
          messages: [{ role: 'user', content: 'hola', authorId: 'u2', authorName: 'Ana' }],
        })}
      />,
    );
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('hola')).toBeInTheDocument();
  });

  it('shows a typing indicator from another member via SSE', async () => {
    render(<PlanChat slug="p" canWrite currentUserId="me" initialPlan={plan()} />);
    const es = FakeEventSource.instances[0];
    expect(es.url).toContain('/plan/stream');
    await act(async () => {
      es.emit({ type: 'typing', userId: 'u2', name: 'Ana' });
    });
    expect(await screen.findByText(/Ana is typing/i)).toBeInTheDocument();
  });

  it('ignores own typing events', async () => {
    render(<PlanChat slug="p" canWrite currentUserId="me" initialPlan={plan()} />);
    const es = FakeEventSource.instances[0];
    await act(async () => {
      es.emit({ type: 'typing', userId: 'me', name: 'Me' });
    });
    expect(screen.queryByText(/is typing/i)).toBeNull();
  });

  it('tracks presence join and leave from SSE (self always online)', async () => {
    render(<PlanChat slug="p" canWrite currentUserId="me" initialPlan={plan()} />);
    const es = FakeEventSource.instances[0];
    // The presence bar is always shown (you are always online).
    expect(screen.getByText(/Online/i)).toBeInTheDocument();
    await act(async () => {
      es.emit({ type: 'presence', state: 'join', userId: 'u2', name: 'Ana' });
    });
    expect(screen.getByText(/Ana/)).toBeInTheDocument();
    await act(async () => {
      es.emit({ type: 'presence', state: 'leave', userId: 'u2', name: 'Ana' });
    });
    // Ana left, but the presence bar (with you) stays.
    expect(screen.queryByText(/Ana/)).toBeNull();
    expect(screen.getByText(/Online/i)).toBeInTheDocument();
  });

  it('pings typing while composing', async () => {
    const user = userEvent.setup();
    render(<PlanChat slug="p" canWrite currentUserId="me" initialPlan={plan()} />);
    await user.type(screen.getByPlaceholderText(/Type your answer/i), 'h');
    expect(h.planTypingAction).toHaveBeenCalledWith('p');
  });

  it('shows Enviar and Generar plan together in the composer', () => {
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate plan/i })).toBeInTheDocument();
  });

  it('shows the connection status once the SSE opens, incl. you', async () => {
    render(<PlanChat slug="p" canWrite currentUserId="me" currentUserName="Manu" initialPlan={plan()} />);
    expect(screen.getByText(/Connecting/i)).toBeInTheDocument();
    await act(async () => {
      FakeEventSource.instances[0].open();
    });
    expect(screen.getByText(/Connected/i)).toBeInTheDocument();
    expect(screen.getByText(/Manu \(you\)/i)).toBeInTheDocument();
  });

  it('does not render context in the chat', () => {
    render(
      <PlanChat
        slug="p"
        canWrite
        initialPlan={plan({
          messages: [{ role: 'user', content: 'usa esto', context: { sources: ['spec.md'] } }],
        })}
      />,
    );
    expect(screen.queryByText('Context:')).toBeNull();
    expect(screen.queryByText('spec.md')).toBeNull();
  });

  it('colors a user message by its author', () => {
    render(
      <PlanChat
        slug="p"
        canWrite
        currentUserId="me"
        members={[{ userId: 'u2', name: 'Ana' }]}
        initialPlan={plan({ messages: [{ role: 'user', content: 'hola', authorId: 'u2', authorName: 'Ana' }] })}
      />,
    );
    // Default palette color for the first member is #3b82f6 → rgb(59, 130, 246).
    const style = screen.getByText('hola').getAttribute('style') ?? '';
    expect(style).toMatch(/#3b82f6|rgb\(59, 130, 246\)/i);
  });

  it('applies live color changes from a colors SSE event', async () => {
    render(
      <PlanChat
        slug="p"
        canWrite
        currentUserId="me"
        members={[{ userId: 'u2', name: 'Ana' }]}
        initialPlan={plan({ messages: [{ role: 'user', content: 'hola', authorId: 'u2', authorName: 'Ana' }] })}
      />,
    );
    await act(async () => {
      FakeEventSource.instances[0].emit({ type: 'colors', colors: { u2: '#ff0000' } });
    });
    const style = screen.getByText('hola').getAttribute('style') ?? '';
    expect(style).toMatch(/#ff0000|rgb\(255, 0, 0\)/i);
  });

  it('restarts the conversation after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.clearPlanChatAction.mockResolvedValue({
      ok: true,
      data: plan({ messages: [{ role: 'assistant', content: 'Fresh start' }] }),
    });
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    await user.click(screen.getByRole('button', { name: /Restart conversation/i }));
    expect(h.clearPlanChatAction).toHaveBeenCalledWith('p');
    expect(await screen.findByText('Fresh start')).toBeInTheDocument();
  });

  it('does not restart when confirmation is declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PlanChat slug="p" canWrite initialPlan={plan()} />);
    await user.click(screen.getByRole('button', { name: /Restart conversation/i }));
    expect(h.clearPlanChatAction).not.toHaveBeenCalled();
  });
});
