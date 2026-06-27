import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const h = vi.hoisted(() => ({
  getConnectOptionsAction: vi.fn(),
  connectDeployTargetAction: vi.fn(),
  deployRepoAction: vi.fn(),
  lifecycleAction: vi.fn(),
  getRollbackTargetsAction: vi.fn(),
  rollbackDeploymentAction: vi.fn(),
  getDeployEnvKeysAction: vi.fn(),
  setDeployEnvAction: vi.fn(),
  getDeploymentLogsAction: vi.fn(),
  getDbCatalogAction: vi.fn(),
  provisionDatabaseAction: vi.fn(),
  getDbCredentialsAction: vi.fn(),
  listImportableAppsAction: vi.fn(),
  linkExistingAppAction: vi.fn(),
  deleteDeploymentAction: vi.fn(),
  refreshDeploymentsAction: vi.fn(),
}));

vi.mock('@/lib/actions/deploy', () => ({ ...h }));

import { DeployClient } from './DeployClient';

type Obj = Record<string, unknown>;

function repo(over: Obj = {}) {
  return { id: 'r1', name: 'api', kind: 'backend', url: 'https://github.com/o/api', deployed: false, ...over };
}
function dep(over: Obj = {}) {
  return {
    id: 'd1',
    fusionAppId: 'app1',
    kind: 'APP',
    name: 'api',
    status: 'LIVE',
    hostname: 'api.example.com',
    url: 'https://api.example.com',
    error: null,
    buildPack: 'DOCKERFILE',
    exposedPort: 3000,
    imported: false,
    repoId: null,
    repoName: null,
    lastDeploymentId: 'ld1',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}
function view(over: Obj = {}) {
  return {
    configured: true,
    connected: true,
    target: { fusionTeamId: 't', fusionProjectId: 'p', environmentId: 'e', serverId: 's' },
    repos: [],
    deployments: [],
    ...over,
  } as any;
}

beforeEach(() => {
  Object.values(h).forEach((fn) => fn.mockReset());
});

describe('DeployClient — gates', () => {
  it('shows the not-configured empty state and stops', () => {
    render(<DeployClient slug="p" initial={view({ configured: false, connected: false })} />);
    expect(screen.getByText('Deployment not configured')).toBeInTheDocument();
    expect(screen.queryByText('Repositories')).toBeNull();
  });

  it('auto-connects when there is a single server', async () => {
    const user = userEvent.setup();
    h.getConnectOptionsAction.mockResolvedValue({
      ok: true,
      data: { servers: [{ id: 's1', name: 'srv', agentStatus: 'ONLINE' }], defaultTeamId: 't' },
    });
    h.connectDeployTargetAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ connected: false })} />);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(h.getConnectOptionsAction).toHaveBeenCalledWith('p');
    expect(h.connectDeployTargetAction).toHaveBeenCalledWith('p', { serverId: 's1' });
    expect(await screen.findByText('Repositories')).toBeInTheDocument();
  });

  it('connects with no server when none are available', async () => {
    const user = userEvent.setup();
    h.getConnectOptionsAction.mockResolvedValue({ ok: true, data: { servers: [], defaultTeamId: 't' } });
    h.connectDeployTargetAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ connected: false })} />);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(h.connectDeployTargetAction).toHaveBeenCalledWith('p', {});
  });

  it('shows a server picker when several are available, then connects', async () => {
    const user = userEvent.setup();
    h.getConnectOptionsAction.mockResolvedValue({
      ok: true,
      data: {
        servers: [
          { id: 's1', name: 'one', agentStatus: 'ONLINE' },
          { id: 's2', name: 'two', agentStatus: 'OFFLINE' },
        ],
        defaultTeamId: 't',
      },
    });
    h.connectDeployTargetAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ connected: false })} />);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('Choose a target server:')).toBeInTheDocument();
    expect(screen.getByText('two')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Use this server' });
    await user.click(buttons[1]!);
    expect(h.connectDeployTargetAction).toHaveBeenCalledWith('p', { serverId: 's2' });
  });

  it('surfaces a connect-options error', async () => {
    const user = userEvent.setup();
    h.getConnectOptionsAction.mockResolvedValue({ ok: false, error: 'no infra' });
    render(<DeployClient slug="p" initial={view({ connected: false })} />);
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('no infra')).toBeInTheDocument();
    expect(h.connectDeployTargetAction).not.toHaveBeenCalled();
  });
});

describe('DeployClient — repos & deploy form', () => {
  it('shows a hint when there are no repos', () => {
    render(<DeployClient slug="p" initial={view()} />);
    expect(screen.getByText(/Link repos on the Plan tab/i)).toBeInTheDocument();
  });

  it('disables deploy and hints when a repo has no GitHub URL', () => {
    render(<DeployClient slug="p" initial={view({ repos: [repo({ url: null })] })} />);
    expect(screen.getByText('No GitHub URL to deploy.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeDisabled();
  });

  it('opens the deploy form, submits, and closes on success', async () => {
    const user = userEvent.setup();
    h.deployRepoAction.mockResolvedValue({
      ok: true,
      data: view({ repos: [repo({ deployed: true })], deployments: [dep({ repoId: 'r1', status: 'BUILDING' })] }),
    });
    h.refreshDeploymentsAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ repos: [repo()] })} />);
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    await user.type(screen.getByPlaceholderText('3000'), '8080');
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    expect(h.deployRepoAction).toHaveBeenCalledWith('p', 'r1', { exposedPort: 8080, dockerfilePath: 'Dockerfile' });
  });

  it('cancels the deploy form', async () => {
    const user = userEvent.setup();
    render(<DeployClient slug="p" initial={view({ repos: [repo()] })} />);
    await user.click(screen.getByRole('button', { name: 'Deploy' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument();
  });
});

describe('DeployClient — status badges & lifecycle', () => {
  it.each([
    ['LIVE', 'Live'],
    ['BUILDING', 'Building…'],
    ['PENDING', 'Pending'],
    ['STOPPED', 'Stopped'],
    ['FAILED', 'Failed'],
  ])('renders the %s badge', (status, label) => {
    h.refreshDeploymentsAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ status })] })} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows the error for a FAILED deployment', () => {
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ status: 'FAILED', error: 'kaboom' })] })} />);
    expect(screen.getByText('kaboom')).toBeInTheDocument();
  });

  it('starts a stopped deployment', async () => {
    const user = userEvent.setup();
    h.lifecycleAction.mockResolvedValue({ ok: true, data: view({ deployments: [dep({ status: 'BUILDING' })] }) });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ status: 'STOPPED' })] })} />);
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(h.lifecycleAction).toHaveBeenCalledWith('p', 'd1', 'start');
  });

  it('stops a live deployment', async () => {
    const user = userEvent.setup();
    h.lifecycleAction.mockResolvedValue({ ok: true, data: view({ deployments: [dep({ status: 'BUILDING' })] }) });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ status: 'LIVE' })] })} />);
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(h.lifecycleAction).toHaveBeenCalledWith('p', 'd1', 'stop');
  });

  it('recreates after confirmation and skips when declined', async () => {
    const user = userEvent.setup();
    h.lifecycleAction.mockResolvedValue({ ok: true, data: view() });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Recreate' }));
    expect(h.lifecycleAction).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Recreate' }));
    expect(h.lifecycleAction).toHaveBeenCalledWith('p', 'd1', 'recreate');
  });

  it('redeploys a repo-linked deployment using its exposed port', async () => {
    const user = userEvent.setup();
    h.deployRepoAction.mockResolvedValue({ ok: true, data: view() });
    render(
      <DeployClient
        slug="p"
        initial={view({ repos: [repo({ deployed: true })], deployments: [dep({ repoId: 'r1', exposedPort: 8080 })] })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Redeploy' }));
    expect(h.deployRepoAction).toHaveBeenCalledWith('p', 'r1', { exposedPort: 8080 });
  });

  it('redeploys with a default port when none is recorded', async () => {
    const user = userEvent.setup();
    h.deployRepoAction.mockResolvedValue({ ok: true, data: view() });
    render(
      <DeployClient
        slug="p"
        initial={view({ repos: [repo({ deployed: true })], deployments: [dep({ repoId: 'r1', exposedPort: null })] })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Redeploy' }));
    expect(h.deployRepoAction).toHaveBeenCalledWith('p', 'r1', { exposedPort: 3000 });
  });

  it('surfaces a lifecycle action error inline', async () => {
    const user = userEvent.setup();
    h.lifecycleAction.mockResolvedValue({ ok: false, error: 'cannot stop' });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ status: 'LIVE' })] })} />);
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText('cannot stop')).toBeInTheDocument();
  });

  it('refreshes deployments from the Refresh button', async () => {
    const user = userEvent.setup();
    h.refreshDeploymentsAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.refreshDeploymentsAction).toHaveBeenCalledWith('p');
  });

  it('renders imported badge', () => {
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ imported: true })] })} />);
    expect(screen.getByText('imported')).toBeInTheDocument();
  });
});

describe('DeployClient — rollback modal', () => {
  it('lists targets and rolls back to one', async () => {
    const user = userEvent.setup();
    h.getRollbackTargetsAction.mockResolvedValue({
      ok: true,
      data: [{ id: 'deadbeefcafe', status: 'FINISHED', operation: 'DEPLOY' }],
    });
    h.rollbackDeploymentAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Rollback' }));
    expect(await screen.findByText('deadbeef')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Roll back to this' }));
    expect(h.rollbackDeploymentAction).toHaveBeenCalledWith('p', 'd1', 'deadbeefcafe');
  });

  it('shows an empty state when there are no rollback targets', async () => {
    const user = userEvent.setup();
    h.getRollbackTargetsAction.mockResolvedValue({ ok: true, data: [] });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Rollback' }));
    expect(await screen.findByText('No previous versions.')).toBeInTheDocument();
  });

  it('surfaces a rollback-targets error', async () => {
    const user = userEvent.setup();
    h.getRollbackTargetsAction.mockResolvedValue({ ok: false, error: 'no history' });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Rollback' }));
    expect(await screen.findByText('no history')).toBeInTheDocument();
  });
});

describe('DeployClient — env modal', () => {
  it('lists keys, unsets one, adds a row and saves', async () => {
    const user = userEvent.setup();
    h.getDeployEnvKeysAction.mockResolvedValue({ ok: true, data: ['EXISTING'] });
    h.setDeployEnvAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Env' }));
    expect(await screen.findByText('EXISTING')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: '+ Row' }));
    const keyInputs = screen.getAllByLabelText(/env-key-/);
    await user.type(keyInputs[0]!, 'NEW');
    const valueInputs = screen.getAllByLabelText(/env-value-/);
    await user.type(valueInputs[0]!, 'v');
    await user.click(screen.getByRole('button', { name: 'Save & redeploy' }));
    expect(h.setDeployEnvAction).toHaveBeenCalledWith('p', 'd1', { set: { NEW: 'v' }, unset: ['EXISTING'] });
  });

  it('toggling a key on then off leaves it unset-free', async () => {
    const user = userEvent.setup();
    h.getDeployEnvKeysAction.mockResolvedValue({ ok: true, data: ['ONLY'] });
    h.setDeployEnvAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Env' }));
    const box = await screen.findByRole('checkbox');
    await user.click(box);
    await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Save & redeploy' }));
    expect(h.setDeployEnvAction).toHaveBeenCalledWith('p', 'd1', { set: undefined, unset: undefined });
  });

  it('shows the no-variables state', async () => {
    const user = userEvent.setup();
    h.getDeployEnvKeysAction.mockResolvedValue({ ok: true, data: [] });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Env' }));
    expect(await screen.findByText('No variables set.')).toBeInTheDocument();
  });

  it('surfaces an env-keys error', async () => {
    const user = userEvent.setup();
    h.getDeployEnvKeysAction.mockResolvedValue({ ok: false, error: 'no keys' });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Env' }));
    expect(await screen.findByText('no keys')).toBeInTheDocument();
  });
});

describe('DeployClient — logs modal', () => {
  it('renders log lines including stderr', async () => {
    const user = userEvent.setup();
    h.getDeploymentLogsAction.mockResolvedValue({
      ok: true,
      data: {
        status: 'IN_PROGRESS',
        lines: [
          { seq: 1, stream: 'stdout', text: 'building' },
          { seq: 2, stream: 'stderr', text: 'oops' },
        ],
      },
    });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Logs' }));
    expect(await screen.findByText('building')).toBeInTheDocument();
    expect(screen.getByText('oops')).toBeInTheDocument();
  });

  it('shows an empty logs state', async () => {
    const user = userEvent.setup();
    h.getDeploymentLogsAction.mockResolvedValue({ ok: true, data: { status: 'PENDING', lines: [] } });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Logs' }));
    expect(await screen.findByText('No logs yet.')).toBeInTheDocument();
  });

  it('surfaces a logs error', async () => {
    const user = userEvent.setup();
    h.getDeploymentLogsAction.mockResolvedValue({ ok: false, error: 'no logs' });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Logs' }));
    expect(await screen.findByText('no logs')).toBeInTheDocument();
  });
});

describe('DeployClient — database credentials', () => {
  it('shows credentials with copy buttons', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    h.getDbCredentialsAction.mockResolvedValue({
      ok: true,
      data: {
        local: { engine: 'POSTGRES', host: 'db', port: 5432, username: 'u', password: 'secret', database: 'app' },
      },
    });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ kind: 'DATABASE', name: 'pg' })] })} />);
    await user.click(screen.getByRole('button', { name: 'Credentials' }));
    expect(await screen.findByText('secret')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'copy-password' }));
    expect(writeText).toHaveBeenCalledWith('secret');
  });

  it('tolerates a missing clipboard', async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    h.getDbCredentialsAction.mockResolvedValue({
      ok: true,
      data: { local: { engine: 'REDIS', host: 'r', port: 6379, username: '', password: 'p', database: '0' } },
    });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ kind: 'DATABASE' })] })} />);
    await user.click(screen.getByRole('button', { name: 'Credentials' }));
    await user.click(await screen.findByRole('button', { name: 'copy-host' }));
    expect(screen.getByText('6379')).toBeInTheDocument();
  });

  it('surfaces a credentials error', async () => {
    const user = userEvent.setup();
    h.getDbCredentialsAction.mockResolvedValue({ ok: false, error: 'no creds' });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ kind: 'DATABASE' })] })} />);
    await user.click(screen.getByRole('button', { name: 'Credentials' }));
    expect(await screen.findByText('no creds')).toBeInTheDocument();
  });
});

describe('DeployClient — delete modal', () => {
  it('deletes with destroy checked', async () => {
    const user = userEvent.setup();
    h.deleteDeploymentAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(h.deleteDeploymentAction).toHaveBeenCalledWith('p', 'd1', { destroy: true });
  });

  it('deletes without destroy and can cancel', async () => {
    const user = userEvent.setup();
    h.deleteDeploymentAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep()] })} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // reopen and confirm without destroy
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(h.deleteDeploymentAction).toHaveBeenCalledWith('p', 'd1', { destroy: false });
  });
});

describe('DeployClient — import section', () => {
  it('lists importable apps and links one to a repo', async () => {
    const user = userEvent.setup();
    h.listImportableAppsAction.mockResolvedValue({
      ok: true,
      data: [{ id: 'a1', name: 'legacy', kind: 'APP', status: 'LIVE', url: 'https://legacy.x' }],
    });
    h.linkExistingAppAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ repos: [repo()] })} />);
    await user.click(screen.getByRole('button', { name: 'Find apps' }));
    expect(await screen.findByText('legacy')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('repo-for-a1'), 'r1');
    await user.click(screen.getByRole('button', { name: 'Link' }));
    expect(h.linkExistingAppAction).toHaveBeenCalledWith('p', 'a1', { repoId: 'r1' });
  });

  it('links an app without a repo', async () => {
    const user = userEvent.setup();
    h.listImportableAppsAction.mockResolvedValue({
      ok: true,
      data: [{ id: 'a1', name: 'legacy', kind: 'APP', status: 'PENDING', url: null }],
    });
    h.linkExistingAppAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view()} />);
    await user.click(screen.getByRole('button', { name: 'Find apps' }));
    await user.click(await screen.findByRole('button', { name: 'Link' }));
    expect(h.linkExistingAppAction).toHaveBeenCalledWith('p', 'a1', {});
  });

  it('shows the empty importable state', async () => {
    const user = userEvent.setup();
    h.listImportableAppsAction.mockResolvedValue({ ok: true, data: [] });
    render(<DeployClient slug="p" initial={view()} />);
    await user.click(screen.getByRole('button', { name: 'Find apps' }));
    expect(await screen.findByText('No unlinked apps.')).toBeInTheDocument();
  });

  it('surfaces an importable-list error', async () => {
    const user = userEvent.setup();
    h.listImportableAppsAction.mockResolvedValue({ ok: false, error: 'list failed' });
    render(<DeployClient slug="p" initial={view()} />);
    await user.click(screen.getByRole('button', { name: 'Find apps' }));
    expect(await screen.findByText('list failed')).toBeInTheDocument();
  });
});

describe('DeployClient — database provisioning', () => {
  it('loads the catalog, picks an engine/version and provisions', async () => {
    const user = userEvent.setup();
    h.getDbCatalogAction.mockResolvedValue({
      ok: true,
      data: [
        { engine: 'POSTGRES', versions: ['16', '15'], default_port: 5432 },
        { engine: 'REDIS', versions: ['7'], default_port: 6379 },
      ],
    });
    h.provisionDatabaseAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view()} />);
    await user.click(screen.getByRole('button', { name: 'Provision database' }));
    const nameInput = await screen.findByLabelText('Name');
    await user.type(nameInput, 'maindb');
    await user.selectOptions(screen.getByLabelText('db-engine'), 'REDIS');
    await user.click(screen.getByLabelText('Expose publicly'));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(h.provisionDatabaseAction).toHaveBeenCalledWith('p', {
      name: 'maindb',
      engine: 'REDIS',
      version: '7',
      exposePublic: true,
    });
  });

  it('keeps Create disabled until a name is entered', async () => {
    const user = userEvent.setup();
    h.getDbCatalogAction.mockResolvedValue({
      ok: true,
      data: [{ engine: 'POSTGRES', versions: ['16'], default_port: 5432 }],
    });
    render(<DeployClient slug="p" initial={view()} />);
    await user.click(screen.getByRole('button', { name: 'Provision database' }));
    expect(await screen.findByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('surfaces a catalog error', async () => {
    const user = userEvent.setup();
    h.getDbCatalogAction.mockResolvedValue({ ok: false, error: 'no catalog' });
    render(<DeployClient slug="p" initial={view()} />);
    await user.click(screen.getByRole('button', { name: 'Provision database' }));
    expect(await screen.findByText('no catalog')).toBeInTheDocument();
  });

  it('handles an empty catalog without preselecting', async () => {
    const user = userEvent.setup();
    h.getDbCatalogAction.mockResolvedValue({ ok: true, data: [] });
    render(<DeployClient slug="p" initial={view()} />);
    await user.click(screen.getByRole('button', { name: 'Provision database' }));
    // form mounts but the Create button stays disabled (no engine)
    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});

describe('DeployClient — polling', () => {
  it('polls while a deployment is building and stops when terminal', async () => {
    vi.useFakeTimers();
    h.refreshDeploymentsAction.mockResolvedValue({
      ok: true,
      data: view({ deployments: [dep({ status: 'LIVE' })] }),
    });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ status: 'BUILDING' })] })} />);
    expect(h.refreshDeploymentsAction).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.refreshDeploymentsAction).toHaveBeenCalledTimes(1);
    // now LIVE -> no more polling
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(h.refreshDeploymentsAction).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('does not poll when all deployments are terminal', async () => {
    vi.useFakeTimers();
    h.refreshDeploymentsAction.mockResolvedValue({ ok: true, data: view() });
    render(<DeployClient slug="p" initial={view({ deployments: [dep({ status: 'LIVE' })] })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(h.refreshDeploymentsAction).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
