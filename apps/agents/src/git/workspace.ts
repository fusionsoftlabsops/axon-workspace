/**
 * Workspace git efímero del agente Dev: clone superficial autenticado en un
 * directorio temporal, rama de trabajo, commit/push y PR vía API de GitHub.
 *
 * El runner de comandos es inyectable (tests sin git real). El token JAMÁS se
 * pasa por argv visible más allá de la URL de clone (mismo approach que
 * graphify-svc) y se redacta de los mensajes de error.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface CommandRunner {
  (cmd: string, args: string[], cwd?: string): Promise<{ code: number; stdout: string; stderr: string }>;
}

export const spawnRunner: CommandRunner = (cmd, args, cwd) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.on('error', (err) => resolve({ code: 127, stdout, stderr: String(err) }));
  });

export interface WorkspaceOptions {
  /** p.ej. https://github.com/org/repo (sin token). */
  repoUrl: string;
  branch: string;
  /** Token de GitHub para clone/push (repos privados). */
  gitToken?: string;
  run?: CommandRunner;
  /** Identidad de los commits del agente. */
  authorName?: string;
  authorEmail?: string;
}

function redact(text: string, token?: string): string {
  return token ? text.split(token).join('***') : text;
}

function authenticatedUrl(repoUrl: string, token?: string): string {
  if (!token) return repoUrl;
  return repoUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}

export class GitWorkspace {
  private constructor(
    readonly dir: string,
    private readonly opts: WorkspaceOptions,
    private readonly run: CommandRunner,
  ) {}

  static async clone(opts: WorkspaceOptions): Promise<GitWorkspace> {
    const run = opts.run ?? spawnRunner;
    const dir = await mkdtemp(join(tmpdir(), 'axon-dev-'));
    const url = authenticatedUrl(opts.repoUrl, opts.gitToken);
    const res = await run('git', ['clone', '--depth', '1', '--branch', opts.branch, url, dir]);
    if (res.code !== 0) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      throw new Error(`git clone falló: ${redact(res.stderr || res.stdout, opts.gitToken)}`);
    }
    const ws = new GitWorkspace(dir, opts, run);
    await ws.git(['config', 'user.name', opts.authorName ?? 'Agente Dev (Axon)']);
    await ws.git(['config', 'user.email', opts.authorEmail ?? 'agent-dev@agents.axon.local']);
    return ws;
  }

  private async git(args: string[]): Promise<string> {
    const res = await this.run('git', args, this.dir);
    if (res.code !== 0) {
      throw new Error(`git ${args[0]} falló: ${redact(res.stderr || res.stdout, this.opts.gitToken)}`);
    }
    return res.stdout;
  }

  async createBranch(name: string): Promise<void> {
    await this.git(['checkout', '-b', name]);
  }

  /** true si hay cambios sin commitear (el modelo escribió algo). */
  async hasChanges(): Promise<boolean> {
    const out = await this.git(['status', '--porcelain']);
    return out.trim().length > 0;
  }

  async commitAll(message: string): Promise<void> {
    await this.git(['add', '-A']);
    await this.git(['commit', '-m', message]);
  }

  async push(branch: string): Promise<void> {
    await this.git(['push', '-u', 'origin', branch]);
  }

  /** Crea el PR vía API REST de GitHub. Devuelve la URL del PR. */
  async openPr(input: { title: string; body: string; head: string; base: string }): Promise<string> {
    const m = this.opts.repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (!m) throw new Error('repoUrl no es de GitHub — no se puede abrir PR');
    const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/pulls`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.opts.gitToken ?? ''}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { html_url?: string; message?: string };
    if (!res.ok || !data.html_url) {
      throw new Error(`GitHub PR falló (${res.status}): ${redact(data.message ?? '', this.opts.gitToken)}`);
    }
    return data.html_url;
  }

  async cleanup(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true }).catch(() => {});
  }
}
