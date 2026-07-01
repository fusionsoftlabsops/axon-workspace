import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  refinePlanTaskAction: vi.fn(),
  updatePlanTaskAction: vi.fn(),
  removePlanTaskAction: vi.fn(),
  updatePlanSprintAction: vi.fn(),
  generateImplPlanAction: vi.fn(),
  getProjectMembersForAssignAction: vi.fn(),
  assignTaskMemberAction: vi.fn(),
  clearTaskAssignmentAction: vi.fn(),
}));

vi.mock('@/lib/actions/planning', () => ({
  refinePlanTaskAction: h.refinePlanTaskAction,
  updatePlanTaskAction: h.updatePlanTaskAction,
  removePlanTaskAction: h.removePlanTaskAction,
  updatePlanSprintAction: h.updatePlanSprintAction,
  generateImplPlanAction: h.generateImplPlanAction,
  getProjectMembersForAssignAction: h.getProjectMembersForAssignAction,
  assignTaskMemberAction: h.assignTaskMemberAction,
  clearTaskAssignmentAction: h.clearTaskAssignmentAction,
}));

import { PlanTaskCard, PlanSprintHead } from './PlanEditors';

function task(over: Record<string, unknown> = {}) {
  return {
    title: 'Build login',
    description: 'desc here',
    acceptanceCriteria: 'must work',
    estimate: '2d',
    estimateBySeniority: { junior: '3d', semiSenior: '2d', senior: '1d' },
    category: 'backend',
    priority: 'HIGH',
    kind: 'STORY',
    recommendedRoles: ['be'],
    repo: 'api',
    assignment: null,
    ...over,
  };
}

function taskProps(over: Record<string, unknown> = {}) {
  return {
    slug: 'p',
    sprintIndex: 0,
    taskIndex: 1,
    task: task(),
    canEdit: true,
    canGenImpl: true,
    repoNames: ['api', 'web'],
    onChange: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe('PlanTaskCard', () => {
  it('renders the view mode with task details and seniority estimates', () => {
    render(<PlanTaskCard {...(taskProps() as never)} />);
    expect(screen.getByText('Build login')).toBeInTheDocument();
    expect(screen.getByText('desc here')).toBeInTheDocument();
    expect(screen.getByText('must work')).toBeInTheDocument();
    expect(screen.getByText(/Jr 3d/)).toBeInTheDocument();
  });

  it('renders read-only estimate badge when canEdit is false', () => {
    render(<PlanTaskCard {...(taskProps({ canEdit: false }) as never)} />);
    expect(screen.getByText('⏱ 2d')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit/i })).toBeNull();
  });

  it('shows the implementation-plan button even when not editable (published)', () => {
    render(<PlanTaskCard {...(taskProps({ canEdit: false, canGenImpl: true }) as never)} />);
    expect(screen.getByRole('button', { name: /Implementation plan/i })).toBeInTheDocument();
    // ...but not the mutating edit controls.
    expect(screen.queryByRole('button', { name: /Edit/i })).toBeNull();
  });

  it('hides the implementation-plan button when it is not allowed', () => {
    render(<PlanTaskCard {...(taskProps({ canEdit: false, canGenImpl: false }) as never)} />);
    expect(screen.queryByRole('button', { name: /Implementation plan/i })).toBeNull();
  });

  it('shows an assignment tag and can clear it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    h.clearTaskAssignmentAction.mockResolvedValue({ ok: true, data: { id: 'x' } });
    render(
      <PlanTaskCard
        {...(taskProps({
          onChange,
          task: task({ assignment: { memberName: 'Ann', seniority: 'SENIOR', estimate: '1d' } }),
        }) as never)}
      />,
    );
    expect(screen.getByText(/Ann · Sr · ⏱ 1d/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(h.clearTaskAssignmentAction).toHaveBeenCalledWith('p', 0, 1);
    expect(onChange).toHaveBeenCalled();
  });

  it('opens the edit form, edits fields and saves', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    h.updatePlanTaskAction.mockResolvedValue({ ok: true, data: { id: 'x' } });
    render(<PlanTaskCard {...(taskProps({ onChange }) as never)} />);
    await user.click(screen.getByRole('button', { name: /Edit/i }));
    const title = screen.getByDisplayValue('Build login');
    await user.clear(title);
    await user.type(title, 'New title');
    await user.type(screen.getByPlaceholderText('1d'), 'x');
    await user.type(screen.getByPlaceholderText('6h'), 'x');
    await user.type(screen.getByPlaceholderText('3h'), 'x');
    await user.selectOptions(screen.getAllByRole('combobox')[0], 'frontend');
    const roles = screen.getByDisplayValue('be');
    await user.clear(roles);
    await user.type(roles, 'be, fe');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.updatePlanTaskAction).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
  });

  it('cancels the edit form', async () => {
    const user = userEvent.setup();
    render(<PlanTaskCard {...(taskProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /Edit/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Build login')).toBeInTheDocument();
  });

  it('reports an error when saving an edit fails', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    h.updatePlanTaskAction.mockResolvedValue({ ok: false, error: 'nope' });
    render(<PlanTaskCard {...(taskProps({ onError }) as never)} />);
    await user.click(screen.getByRole('button', { name: /Edit/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onError).toHaveBeenCalledWith('nope');
  });

  it('toggles the refine box and re-analyzes', async () => {
    const user = userEvent.setup();
    h.refinePlanTaskAction.mockResolvedValue({ ok: true, data: { id: 'x' } });
    render(<PlanTaskCard {...(taskProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /Re-analyze$/i }));
    await user.type(screen.getByRole('textbox'), 'split it');
    await user.click(screen.getByRole('button', { name: /Re-analyze with AI/i }));
    expect(h.refinePlanTaskAction).toHaveBeenCalledWith('p', 0, 1, 'split it');
  });

  it('closes the refine box with cancel', async () => {
    const user = userEvent.setup();
    render(<PlanTaskCard {...(taskProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /Re-analyze$/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('removes a task after confirmation', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    h.removePlanTaskAction.mockResolvedValue({ ok: true, data: { id: 'x' } });
    render(<PlanTaskCard {...(taskProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /🗑/ }));
    expect(h.removePlanTaskAction).toHaveBeenCalledWith('p', 0, 1);
  });

  it('does not remove a task when confirmation is declined', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<PlanTaskCard {...(taskProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /🗑/ }));
    expect(h.removePlanTaskAction).not.toHaveBeenCalled();
  });

  it('generates an implementation plan and triggers a download', async () => {
    const user = userEvent.setup();
    const createUrl = vi.fn(() => 'blob:1');
    const revokeUrl = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL: createUrl, revokeObjectURL: revokeUrl });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    h.generateImplPlanAction.mockResolvedValue({
      ok: true,
      data: { markdown: '# plan', filename: 'plan.md', fileId: 'f1' },
    });
    render(<PlanTaskCard {...(taskProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /Implementation plan/i }));
    expect(createUrl).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(await screen.findByText(/saved to Files/i)).toBeInTheDocument();
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('reports an error when generating the impl plan fails', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    h.generateImplPlanAction.mockResolvedValue({ ok: false, error: 'fail' });
    render(<PlanTaskCard {...(taskProps({ onError }) as never)} />);
    await user.click(screen.getByRole('button', { name: /Implementation plan/i }));
    expect(onError).toHaveBeenCalledWith('fail');
  });

  it('opens the assign modal, loads members and assigns one', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    h.getProjectMembersForAssignAction.mockResolvedValue({
      ok: true,
      data: { members: [{ userId: 'u1', name: 'Ann', seniority: 'JUNIOR' }, { userId: 'u2', name: 'Bo', seniority: null }] },
    });
    h.assignTaskMemberAction.mockResolvedValue({ ok: true, data: { id: 'x' } });
    render(<PlanTaskCard {...(taskProps({ onChange }) as never)} />);
    await user.click(screen.getByRole('button', { name: /⏱ 2d/ }));
    expect(await screen.findByText('Ann')).toBeInTheDocument();
    expect(screen.getByText(/no seniority/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Ann/ }));
    expect(h.assignTaskMemberAction).toHaveBeenCalledWith('p', 0, 1, 'u1');
    expect(onChange).toHaveBeenCalled();
  });

  it('shows an empty members message in the assign modal', async () => {
    const user = userEvent.setup();
    h.getProjectMembersForAssignAction.mockResolvedValue({ ok: false });
    render(<PlanTaskCard {...(taskProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /⏱ 2d/ }));
    expect(await screen.findByText(/No project members/i)).toBeInTheDocument();
  });
});

describe('PlanSprintHead', () => {
  function sprintProps(over: Record<string, unknown> = {}) {
    return {
      slug: 'p',
      sprintIndex: 0,
      name: 'Sprint 1',
      goal: 'ship mvp',
      canEdit: true,
      open: true,
      onToggle: vi.fn(),
      taskCount: 3,
      onChange: vi.fn(),
      onError: vi.fn(),
      ...over,
    };
  }

  it('renders the header with name, count and goal when open', () => {
    render(<PlanSprintHead {...(sprintProps() as never)} />);
    expect(screen.getByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('ship mvp')).toBeInTheDocument();
  });

  it('calls onToggle when the toggle is clicked', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<PlanSprintHead {...(sprintProps({ onToggle, open: false }) as never)} />);
    await user.click(screen.getByRole('button', { name: /Sprint 1/ }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('hides edit controls when canEdit is false', () => {
    render(<PlanSprintHead {...(sprintProps({ canEdit: false }) as never)} />);
    expect(screen.queryByRole('button', { name: /Edit/i })).toBeNull();
  });

  it('edits and saves the sprint', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    h.updatePlanSprintAction.mockResolvedValue({ ok: true, data: { id: 'x' } });
    render(<PlanSprintHead {...(sprintProps({ onChange }) as never)} />);
    await user.click(screen.getByRole('button', { name: /Edit/i }));
    const name = screen.getByPlaceholderText('Sprint name');
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(h.updatePlanSprintAction).toHaveBeenCalledWith('p', 0, { name: 'Renamed', goal: 'ship mvp' });
    expect(onChange).toHaveBeenCalled();
  });

  it('reports an error when saving the sprint fails', async () => {
    const user = userEvent.setup();
    const onError = vi.fn();
    h.updatePlanSprintAction.mockResolvedValue({ ok: false, error: 'bad' });
    render(<PlanSprintHead {...(sprintProps({ onError }) as never)} />);
    await user.click(screen.getByRole('button', { name: /Edit/i }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onError).toHaveBeenCalledWith('bad');
  });

  it('cancels sprint editing', async () => {
    const user = userEvent.setup();
    render(<PlanSprintHead {...(sprintProps() as never)} />);
    await user.click(screen.getByRole('button', { name: /Edit/i }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('heading', { name: 'Sprint 1' })).toBeInTheDocument();
  });
});
