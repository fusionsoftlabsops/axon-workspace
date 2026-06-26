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
    if GITHUB_TOKEN:
        url = f"https://x-access-token:{GITHUB_TOKEN}@github.com/{base}.git"
    else:
        url = f"https://github.com/{base}.git"
    return url, base


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


def run_extract(scan_root: Path, out_dir: Path, backend: str) -> str:
    """Run `python -m graphify extract <scan_root> --backend <backend>` writing
    its output under `out_dir`. Returns the captured stdout. Raises RuntimeError."""
    env = {**os.environ, "GRAPHIFY_OUT": str(out_dir)}
    cmd = [sys.executable, "-m", "graphify", "extract", str(scan_root), "--backend", backend]
    proc = subprocess.run(
        cmd, cwd=str(scan_root), env=env, capture_output=True, text=True, timeout=EXTRACT_TIMEOUT
    )
    if proc.returncode != 0:
        raise RuntimeError(f"graphify extract failed: {_scrub(proc.stderr or proc.stdout).strip()[:800]}")
    return proc.stdout or ""


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
    workdir = Path(tempfile.mkdtemp(prefix="graphify-svc-"))
    cloned: list[str] = []
    try:
        scan_root = workdir / "repos"
        scan_root.mkdir(parents=True, exist_ok=True)
        for repo in body.repos:
            url, full = resolve_repo(repo)
            dest = scan_root / re.sub(r"[^A-Za-z0-9._-]", "-", repo.name)
            try:
                clone_repo(url, repo.branch, dest)
            except RuntimeError as exc:
                raise HTTPException(502, f"clone of {full} failed: {exc}")
            cloned.append(full)

        out_dir = workdir / "graphify-out"
        try:
            stdout = run_extract(scan_root, out_dir, backend)
        except subprocess.TimeoutExpired:
            raise HTTPException(504, "graphify extract timed out")
        except RuntimeError as exc:
            raise HTTPException(500, str(exc))

        graph = load_graph(out_dir)
        stats = {**summarize_graph(graph), **parse_stats(stdout), "backend": backend}
        return {
            "graph": graph,
            "stats": stats,
            "report": load_report(out_dir),
            "backend": backend,
            "repos": cloned,
        }
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
