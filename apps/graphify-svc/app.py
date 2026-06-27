"""
graphify-svc — thin HTTP wrapper around the `graphify` (PyPI: graphifyy) code
knowledge-graph engine, for Axon's "analyze an existing project" onboarding.

It clones a project's GitHub repos and runs the proven `python -m graphify
extract` pipeline over them, returning the combined knowledge graph
({nodes, edges, communities}) plus stats. Axon (Next.js) calls it over the
internal `fusion` Docker network, mirroring how it already calls the self-hosted
infra LLM (see apps/web/src/lib/ai/infra-llm.ts).

Security posture (it holds a GitHub PAT + an extraction-LLM key):
  - only clones repos whose owner is in GRAPHIFY_ALLOWED_ORGS (default the org);
  - optional bearer auth via GRAPHIFY_AUTH_TOKEN (Axon forwards it);
  - never returns the token; clone URL with the token is never logged.

Env:
  GRAPHIFY_GITHUB_TOKEN   PAT with read access to the private repos (optional for public)
  GRAPHIFY_ALLOWED_ORGS   comma-separated allowlist of GitHub orgs (default: fusionsoftlabsops)
  GRAPHIFY_AUTH_TOKEN     if set, callers must send `Authorization: Bearer <it>`
  GRAPHIFY_BACKEND        default extraction backend (default: deepseek)
  DEEPSEEK_API_KEY / ANTHROPIC_API_KEY / ...  read by graphify itself for extraction
  GRAPHIFY_MAX_REPOS      cap on repos per request (default 10)
  GRAPHIFY_EXTRACT_TIMEOUT  seconds before the extract subprocess is killed (default 1500)
"""

from __future__ import annotations

import os
import re
import sys
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

APP_VERSION = "0.1.0"

ALLOWED_ORGS = {
    o.strip().lower()
    for o in os.environ.get("GRAPHIFY_ALLOWED_ORGS", "fusionsoftlabsops").split(",")
    if o.strip()
}
GITHUB_TOKEN = os.environ.get("GRAPHIFY_GITHUB_TOKEN", "").strip()
AUTH_TOKEN = os.environ.get("GRAPHIFY_AUTH_TOKEN", "").strip()
DEFAULT_BACKEND = os.environ.get("GRAPHIFY_BACKEND", "deepseek").strip() or "deepseek"
MAX_REPOS = int(os.environ.get("GRAPHIFY_MAX_REPOS", "10"))
EXTRACT_TIMEOUT = int(os.environ.get("GRAPHIFY_EXTRACT_TIMEOUT", "1500"))

app = FastAPI(title="graphify-svc", version=APP_VERSION)


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #
class RepoIn(BaseModel):
    name: str
    cloneUrl: Optional[str] = None
    githubFullName: Optional[str] = None  # "owner/repo"
    branch: Optional[str] = "main"
    kind: Optional[str] = "other"


class AnalyzeIn(BaseModel):
    repos: list[RepoIn]
    backend: Optional[str] = None
    jobId: Optional[str] = None  # caller-supplied id to poll /progress/{jobId}


# --------------------------------------------------------------------------- #
# Helpers (kept as module-level functions so tests can monkeypatch them)
# --------------------------------------------------------------------------- #
_FULLNAME_RE = re.compile(r"github\.com[:/]+([^/\s]+)/([^/\s.]+)", re.IGNORECASE)


def resolve_repo(repo: RepoIn) -> tuple[str, str]:
    """Return (authenticated_clone_url, owner/repo) after validating the org
    allowlist. Raises HTTPException on bad/disallowed input."""
    full = (repo.githubFullName or "").strip()
    if not full and repo.cloneUrl:
        m = _FULLNAME_RE.search(repo.cloneUrl)
        if m:
            full = f"{m.group(1)}/{m.group(2)}"
    if not full or "/" not in full:
        raise HTTPException(400, f"repo '{repo.name}': need githubFullName or a github cloneUrl")
    owner, name = full.split("/", 1)
    owner = owner.lower()
    if ALLOWED_ORGS and owner not in ALLOWED_ORGS:
        raise HTTPException(403, f"repo owner '{owner}' is not in the allowlist")
    base = full if not full.endswith(".git") else full[:-4]
    clone = (repo.cloneUrl or "").strip()
    # 1) Caller supplied an ALREADY-AUTHENTICATED clone URL (e.g. Axon embeds its
    #    own GITHUB_TOKEN as https://x-access-token:<tok>@github.com/...). Use it
    #    as-is so this service needs no GitHub token of its own.
    if clone and "@" in clone.split("github.com", 1)[0]:
        return clone, base
    # 2) This service has its own token.
    if GITHUB_TOKEN:
        return f"https://x-access-token:{GITHUB_TOKEN}@github.com/{base}.git", base
    # 3) Public repo.
    return f"https://github.com/{base}.git", base


def clone_repo(url: str, branch: Optional[str], dest: Path) -> None:
    """Shallow-clone a repo to `dest`. Falls back to the default branch when the
    requested branch does not exist. Raises RuntimeError on failure."""
    base_cmd = ["git", "clone", "--depth", "1", "--single-branch"]
    attempts = []
    if branch:
        attempts.append(base_cmd + ["--branch", branch, url, str(dest)])
    attempts.append(base_cmd + [url, str(dest)])  # default branch fallback
    last_err = ""
    for cmd in attempts:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if proc.returncode == 0:
            return
        # scrub any token that may appear in echoed URLs
        last_err = _scrub(proc.stderr or proc.stdout)
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
    raise RuntimeError(f"git clone failed: {last_err.strip()[:500]}")


def run_extract(scan_root: Path, out_dir: Path, backend: str, on_line=None) -> str:
    """Run `python -m graphify extract <scan_root> --backend <backend>` writing
    its output under `out_dir`. Streams stdout line-by-line to `on_line` (for live
    progress) and returns the full captured stdout. Raises RuntimeError on failure."""
    env = {**os.environ, "GRAPHIFY_OUT": str(out_dir)}
    cmd = [sys.executable, "-m", "graphify", "extract", str(scan_root), "--backend", backend]
    proc = subprocess.Popen(
        cmd, cwd=str(scan_root), env=env, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, text=True, bufsize=1,
    )
    lines: list[str] = []
    try:
        assert proc.stdout is not None
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            lines.append(line)
            if on_line:
                try:
                    on_line(line)
                except Exception:
                    pass
        proc.wait(timeout=EXTRACT_TIMEOUT)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise
    if proc.returncode != 0:
        tail = _scrub("\n".join(lines[-20:])).strip()[:800]
        raise RuntimeError(f"graphify extract failed: {tail}")
    return "\n".join(lines)


# ---- live progress (keyed by the caller's jobId) --------------------------- #
PROGRESS: dict[str, dict] = {}
_CHUNK_RE = re.compile(r"chunk\s+(\d+)\s*/\s*(\d+)", re.IGNORECASE)
_FOUND_RE = re.compile(r"found\s+(\d+)\s+code", re.IGNORECASE)
_SEM_RE = re.compile(r"semantic extraction on\s+(\d+)\s+files", re.IGNORECASE)
_WROTE_RE = re.compile(r"wrote.*?(\d[\d,]*)\s+nodes,\s*(\d[\d,]*)\s+edges", re.IGNORECASE)


def parse_progress(line: str, state: dict) -> dict:
    """Fold one graphify stdout line into the progress state {phase, percent, …}."""
    low = line.lower()
    m = _FOUND_RE.search(line)
    if m:
        state.update(phase="extracting", codeFiles=int(m.group(1)), percent=max(state.get("percent", 0), 15))
    m = _SEM_RE.search(line)
    if m:
        state.update(phase="extracting", semanticFiles=int(m.group(1)), percent=max(state.get("percent", 0), 20))
    m = _CHUNK_RE.search(line)
    if m:
        done, total = int(m.group(1)), max(1, int(m.group(2)))
        # chunks span 20%→90% of the bar.
        state.update(phase="extracting", chunksDone=done, chunksTotal=total,
                     percent=20 + int(70 * done / total))
    if "deduplicat" in low:
        state.update(phase="building", percent=max(state.get("percent", 0), 92))
    m = _WROTE_RE.search(line)
    if m:
        state.update(phase="done", percent=100,
                     nodes=int(m.group(1).replace(",", "")), edges=int(m.group(2).replace(",", "")))
    return state


def _scrub(text: str) -> str:
    """Remove any embedded GitHub token from text before returning/logging."""
    out = text
    if GITHUB_TOKEN:
        out = out.replace(GITHUB_TOKEN, "***")
    return re.sub(r"x-access-token:[^@]+@", "x-access-token:***@", out)


_COST_RE = re.compile(
    r"tokens:\s*([\d,]+)\s*in\s*/\s*([\d,]+)\s*out.*?\$([\d.]+)", re.IGNORECASE | re.DOTALL
)


def parse_stats(stdout: str) -> dict:
    """Best-effort parse of the tokens/cost line graphify prints, e.g.
    'tokens: 43,356 in / 7,443 out, est. cost (~deepseek): $0.0082'."""
    m = _COST_RE.search(stdout or "")
    if not m:
        return {}
    return {
        "tokensIn": int(m.group(1).replace(",", "")),
        "tokensOut": int(m.group(2).replace(",", "")),
        "costUsd": float(m.group(3)),
    }


def summarize_graph(graph: dict) -> dict:
    """Counts (nodes / edges / communities) from a node-link graph dict."""
    nodes = graph.get("nodes") or []
    edges = graph.get("links") or graph.get("edges") or []
    communities = {
        n.get("community") for n in nodes if isinstance(n, dict) and n.get("community") is not None
    }
    return {"nodes": len(nodes), "edges": len(edges), "communities": len(communities)}


def load_graph(out_dir: Path) -> dict:
    gp = out_dir / "graph.json"
    if not gp.exists():
        raise RuntimeError("graphify produced no graph.json")
    data = json.loads(gp.read_text(encoding="utf-8"))
    # normalize the edge key so consumers can rely on `edges`
    if "edges" not in data and "links" in data:
        data["edges"] = data["links"]
    return data


def load_report(out_dir: Path) -> Optional[str]:
    rp = out_dir / "GRAPH_REPORT.md"
    return rp.read_text(encoding="utf-8") if rp.exists() else None


def merge_graph(combined: dict, graph: dict, repo: str, comm_base: int) -> int:
    """Append one repo's node-link graph into `combined`, namespacing node ids by
    repo (avoids cross-repo collisions) and offsetting community ids so each repo
    keeps distinct communities. Returns the next free community base."""
    def pid(nid):
        return f"{repo}::{nid}"

    nodes = graph.get("nodes") or []
    edges = graph.get("links") or graph.get("edges") or []
    next_base = comm_base
    for n in nodes:
        if not isinstance(n, dict):
            continue
        n2 = dict(n)
        n2["id"] = pid(n.get("id"))
        n2["repo"] = repo
        c = n.get("community")
        if c is not None:
            try:
                n2["community"] = comm_base + int(c)
                next_base = max(next_base, comm_base + int(c) + 1)
            except (TypeError, ValueError):
                pass
        combined["nodes"].append(n2)
    for e in edges:
        if not isinstance(e, dict):
            continue
        s, t = e.get("source"), e.get("target")
        s = s if isinstance(s, str) else (s.get("id") if isinstance(s, dict) else s)
        t = t if isinstance(t, str) else (t.get("id") if isinstance(t, dict) else t)
        e2 = dict(e)
        e2["source"], e2["target"] = pid(s), pid(t)
        combined["links"].append(e2)
    return next_base


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "graphify-svc",
        "version": APP_VERSION,
        "githubConfigured": bool(GITHUB_TOKEN),
        "defaultBackend": DEFAULT_BACKEND,
        "allowedOrgs": sorted(ALLOWED_ORGS),
    }


@app.post("/analyze")
def analyze(body: AnalyzeIn, authorization: Optional[str] = Header(default=None)) -> dict:
    if AUTH_TOKEN and authorization != f"Bearer {AUTH_TOKEN}":
        raise HTTPException(401, "unauthorized")
    if not body.repos:
        raise HTTPException(400, "at least one repo is required")
    if len(body.repos) > MAX_REPOS:
        raise HTTPException(400, f"too many repos (max {MAX_REPOS})")

    backend = (body.backend or DEFAULT_BACKEND).strip()
    job = body.jobId
    prog: dict = {"phase": "cloning", "percent": 2}
    if job:
        PROGRESS[job] = prog

    workdir = Path(tempfile.mkdtemp(prefix="graphify-svc-"))
    cloned: list[str] = []
    combined: dict = {"directed": True, "nodes": [], "links": []}
    total = len(body.repos)
    comm_base = 0
    tok_in = tok_out = 0
    cost = 0.0
    errors: list[str] = []
    try:
        # Process ONE repo at a time (clone → extract → merge → free) so the peak
        # memory is a single repo's worth, not all of them — the host can't hold
        # the AST/graph of every repo at once.
        for i, repo in enumerate(body.repos):
            url, full = resolve_repo(repo)
            if job:
                prog.update(phase="cloning", repo=repo.name, repoIndex=i + 1,
                            repoTotal=total, percent=int(i * 100 / total))
            repo_dir = workdir / f"r{i}"
            repo_out = workdir / f"out{i}"
            try:
                clone_repo(url, repo.branch, repo_dir)
            except RuntimeError as exc:
                raise HTTPException(502, f"clone of {full} failed: {exc}")
            cloned.append(full)

            rstate: dict = {}

            def on_line(ln, _rs=rstate, _i=i, _rn=repo.name):
                parse_progress(ln, _rs)
                if job:
                    rp = _rs.get("percent", 0)
                    prog.update(phase=_rs.get("phase", "extracting"), repo=_rn,
                                repoIndex=_i + 1, repoTotal=total,
                                chunksDone=_rs.get("chunksDone"), chunksTotal=_rs.get("chunksTotal"),
                                percent=int((_i * 100 + rp) / total))

            stdout = ""
            try:
                stdout = run_extract(repo_dir, repo_out, backend, on_line=on_line if job else None)
                graph = load_graph(repo_out)
            except subprocess.TimeoutExpired:
                errors.append(f"{repo.name}: timed out")
                continue
            except Exception as exc:
                tail = _scrub("\n".join((stdout or "").splitlines()[-10:])).strip()[:400]
                errors.append(f"{repo.name}: {exc} · {tail}")
                continue

            comm_base = merge_graph(combined, graph, repo.name, comm_base)
            s = parse_stats(stdout)
            tok_in += s.get("tokensIn", 0)
            tok_out += s.get("tokensOut", 0)
            cost += s.get("costUsd", 0.0)

            # Free this repo's clone + output before the next one.
            del graph
            shutil.rmtree(repo_dir, ignore_errors=True)
            shutil.rmtree(repo_out, ignore_errors=True)

        combined["edges"] = combined["links"]
        if not combined["nodes"]:
            detail = ("; ".join(errors))[:600] or "no graph produced"
            if job:
                prog.update(phase="failed", error=detail[:200])
            raise HTTPException(500, f"all repos failed: {detail}")

        stats = {
            **summarize_graph(combined), "backend": backend,
            "tokensIn": tok_in, "tokensOut": tok_out, "costUsd": round(cost, 4),
        }
        if errors:
            stats["skipped"] = errors
        if job:
            prog.update(phase="done", percent=100,
                        **{k: stats[k] for k in ("nodes", "edges", "communities") if k in stats})
        return {
            "graph": combined,
            "stats": stats,
            "report": None,
            "backend": backend,
            "repos": cloned,
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@app.get("/progress/{job_id}")
def progress(job_id: str) -> dict:
    """Live progress for an in-flight /analyze call (by jobId). Returns
    {phase, percent, chunksDone, chunksTotal, …} or {phase:'unknown'}."""
    return PROGRESS.get(job_id) or {"phase": "unknown", "percent": 0}
