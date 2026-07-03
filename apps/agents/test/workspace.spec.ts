import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitWorkspace, type CommandRunner } from '../src/git/workspace.js';

const fetchMock = vi.fn();
const realFetch = globalThis.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function okRunner(overrides: Record<string, { code: number; stdout?: string; stderr?: string }> = {}): {
  run: CommandRunner;
  calls: Array<{ args: string[]; cwd?: string }>;
} {
  const calls: Array<{ args: string[]; cwd?: string }> = [];
  const run: CommandRunner = async (_cmd, args, cwd) => {
    calls.push({ args, cwd });
    const key = args[0]!;
    const o = overrides[key];
    return { code: o?.code ?? 0, stdout: o?.stdout ?? '', stderr: o?.stderr ?? '' };
  };
  return { run, calls };
}

const OPTS = {
  repoUrl: 'https://github.com/fusionsoftlabsops/axon-workspace',
  branch: 'main',
  gitToken: 'ghp_secreto',
};

describe('GitWorkspace', () => {
  it('clona con URL autenticada, configura identidad y opera la rama', async () => {
    const { run, calls } = okRunner();
    const ws = await GitWorkspace.clone({ ...OPTS, run });
    expect(calls[0]!.args[0]).toBe('clone');
    expect(calls[0]!.args).toContain('https://x-access-token:ghp_secreto@github.com/fusionsoftlabsops/axon-workspace');
    expect(calls[1]!.args).toEqual(['config', 'user.name', 'Agente Dev (Axon)']);

    await ws.createBranch('agent/hu-13');
    await ws.commitAll('feat: HU 13');
    await ws.push('agent/hu-13');
    const ops = calls.map((c) => c.args[0]);
    expect(ops).toEqual(expect.arrayContaining(['checkout', 'add', 'commit', 'push']));
    await ws.cleanup();
  });

  it('hasChanges refleja git status --porcelain', async () => {
    const dirty = okRunner({ status: { code: 0, stdout: ' M src/x.ts\n' } });
    const ws1 = await GitWorkspace.clone({ ...OPTS, run: dirty.run });
    expect(await ws1.hasChanges()).toBe(true);
    await ws1.cleanup();

    const clean = okRunner({ status: { code: 0, stdout: '\n' } });
    const ws2 = await GitWorkspace.clone({ ...OPTS, run: clean.run });
    expect(await ws2.hasChanges()).toBe(false);
    await ws2.cleanup();
  });

  it('redacta el token en errores de git', async () => {
    const { run } = okRunner({ clone: { code: 128, stderr: 'fatal: https://x-access-token:ghp_secreto@github.com denied' } });
    await expect(GitWorkspace.clone({ ...OPTS, run })).rejects.toThrow(/\*\*\*/);
    await expect(GitWorkspace.clone({ ...OPTS, run })).rejects.not.toThrow(/ghp_secreto/);
  });

  it('openPr llama a la API de GitHub y devuelve la URL', async () => {
    const { run } = okRunner();
    const ws = await GitWorkspace.clone({ ...OPTS, run });
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ html_url: 'https://github.com/x/pr/1' }) });
    const url = await ws.openPr({ title: 't', body: 'b', head: 'agent/hu-13', base: 'main' });
    expect(url).toBe('https://github.com/x/pr/1');
    const [apiUrl, init] = fetchMock.mock.calls[0]!;
    expect(apiUrl).toBe('https://api.github.com/repos/fusionsoftlabsops/axon-workspace/pulls');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ghp_secreto');
    await ws.cleanup();
  });

  it('openPr falla claro en errores del API y en repos no-GitHub', async () => {
    const { run } = okRunner();
    const ws = await GitWorkspace.clone({ ...OPTS, run });
    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ message: 'no diff' }) });
    await expect(ws.openPr({ title: 't', body: 'b', head: 'h', base: 'main' })).rejects.toThrow('422');
    await ws.cleanup();

    const ws2 = await GitWorkspace.clone({ ...OPTS, repoUrl: 'https://gitlab.com/x/y', run });
    await expect(ws2.openPr({ title: 't', body: 'b', head: 'h', base: 'main' })).rejects.toThrow('no es de GitHub');
    await ws2.cleanup();
  });
});
