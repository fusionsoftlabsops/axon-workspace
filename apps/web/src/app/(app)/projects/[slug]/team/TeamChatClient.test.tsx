import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({ postTeamChatAction: vi.fn() }));
vi.mock('@/lib/actions/team-chat', () => ({ postTeamChatAction: h.postTeamChatAction }));

// Minimal EventSource stub so the SSE effect can mount and we can drive events.
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

import { TeamChatClient } from './TeamChatClient';
import type { TeamMessageView } from '@/lib/agents/team-chat';

function msg(over: Partial<TeamMessageView> = {}): TeamMessageView {
  return {
    id: 'm1',
    authorId: 'a1',
    agentRole: null,
    authorName: 'Manuel',
    kind: 'CHAT',
    body: 'hola equipo',
    storyNumber: null,
    createdAt: '2026-07-03T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  h.postTeamChatAction.mockReset();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = vi.fn();
});

describe('TeamChatClient', () => {
  it('renders the empty state when there is no conversation yet', () => {
    render(<TeamChatClient slug="axon" canWrite initialMessages={[]} />);
    expect(screen.getByText(/No conversation yet/i)).toBeInTheDocument();
  });

  it('renders initial messages, distinguishing agent from human turns', () => {
    render(
      <TeamChatClient
        slug="axon"
        canWrite
        initialMessages={[
          msg({ id: 'm1', authorName: 'Manuel', body: 'hola equipo' }),
          msg({ id: 'm2', agentRole: 'DEV', authorName: 'Kai · DEV', kind: 'STATUS', body: 'Tomo la HU #24', storyNumber: 24 }),
        ]}
      />,
    );
    expect(screen.getByText('hola equipo')).toBeInTheDocument();
    expect(screen.getByText(/Kai · DEV/)).toBeInTheDocument();
    expect(screen.getByText('Tomo la HU #24')).toBeInTheDocument();
    expect(screen.getByText('HU #24')).toBeInTheDocument();
    expect(screen.getByText(/estado|status/i)).toBeInTheDocument();
  });

  it('subscribes to the team SSE stream for this project', () => {
    render(<TeamChatClient slug="axon" canWrite initialMessages={[]} />);
    expect(FakeEventSource.instances[0].url).toContain('/api/v1/projects/axon/team-chat/stream');
  });

  it('shows live/reconnecting status from the SSE lifecycle', async () => {
    render(<TeamChatClient slug="axon" canWrite initialMessages={[]} />);
    expect(screen.getByText(/Reconnecting/i)).toBeInTheDocument();
    await act(async () => {
      FakeEventSource.instances[0].open();
    });
    expect(screen.getByText(/Live/i)).toBeInTheDocument();
  });

  it('appends a new message that arrives over SSE, deduping by id', async () => {
    render(<TeamChatClient slug="axon" canWrite initialMessages={[msg({ id: 'm1' })]} />);
    await act(async () => {
      FakeEventSource.instances[0].emit({ type: 'team.message', message: msg({ id: 'm1' }) });
    });
    expect(screen.getAllByText('hola equipo')).toHaveLength(1);
    await act(async () => {
      FakeEventSource.instances[0].emit({
        type: 'team.message',
        message: msg({ id: 'm2', agentRole: 'QA', authorName: 'Vera · QA', kind: 'HANDOFF', body: 'Aprobada' }),
      });
    });
    expect(screen.getByText('Aprobada')).toBeInTheDocument();
  });

  it('sends a message and appends the result', async () => {
    const user = userEvent.setup();
    h.postTeamChatAction.mockResolvedValue({ ok: true, data: msg({ id: 'm-new', body: 'que tal' }) });
    render(<TeamChatClient slug="axon" canWrite initialMessages={[]} />);
    await user.type(screen.getByPlaceholderText(/Write to the team/i), 'que tal');
    await user.click(screen.getByRole('button', { name: /Enviar|Send/ }));
    expect(h.postTeamChatAction).toHaveBeenCalledWith('axon', 'que tal');
    expect(await screen.findByText('que tal')).toBeInTheDocument();
  });

  it('sends on Enter and surfaces an error from the action', async () => {
    const user = userEvent.setup();
    h.postTeamChatAction.mockResolvedValue({ ok: false, error: 'boom' });
    render(<TeamChatClient slug="axon" canWrite initialMessages={[]} />);
    await user.type(screen.getByPlaceholderText(/Write to the team/i), 'hola{Enter}');
    expect(h.postTeamChatAction).toHaveBeenCalledWith('axon', 'hola');
    expect(await screen.findByText('boom')).toBeInTheDocument();
  });

  it('hides the composer for read-only members', () => {
    render(<TeamChatClient slug="axon" canWrite={false} initialMessages={[]} />);
    expect(screen.queryByPlaceholderText(/Write to the team/i)).toBeNull();
  });
});
