"""Additional tests to exercise the clone/extract pipeline, error branches,
progress tracking and merge edge-cases that the original test_app.py didn't
reach. All external effects (git clone, the graphify subprocess, filesystem)
are mocked/monkeypatched so the suite stays offline and deterministic."""

import json
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app as svc

client = TestClient(svc.app)

FIXTURE_GRAPH = {
    "directed": True,
    "nodes": [
        {"id": "a", "label": "Auth", "community": 0},
        {"id": "b", "label": "Db", "community": 0},
        {"id": "c", "label": "Api", "community": 1},
    ],
    "links": [
        {"source": "a", "target": "b"},
        {"source": "c", "target": "a"},
    ],
}


# --------------------------------------------------------------------------- #
# resolve_repo
# --------------------------------------------------------------------------- #
def test_resolve_repo_needs_fullname_or_github_url():
    # no githubFullName and no usable cloneUrl -> 400 (line 89)
    with pytest.raises(svc.HTTPException) as ei:
        svc.resolve_repo(svc.RepoIn(name="x"))
    assert ei.value.status_code == 400


def test_resolve_repo_extracts_fullname_from_clone_url(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "GITHUB_TOKEN", "")
    url, full = svc.resolve_repo(
        svc.RepoIn(name="web", cloneUrl="https://github.com/fusionsoftlabsops/idea-forge-web.git")
    )
    assert full == "fusionsoftlabsops/idea-forge-web"
    assert url == "https://github.com/fusionsoftlabsops/idea-forge-web.git"


def test_resolve_repo_uses_service_token(monkeypatch):
    # service has its own token -> embeds x-access-token (lines 102-103)
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "GITHUB_TOKEN", "ghp_servicetoken")
    url, full = svc.resolve_repo(
        svc.RepoIn(name="web", githubFullName="fusionsoftlabsops/idea-forge-web")
    )
    assert url == "https://x-access-token:ghp_servicetoken@github.com/fusionsoftlabsops/idea-forge-web.git"
    assert full == "fusionsoftlabsops/idea-forge-web"


# --------------------------------------------------------------------------- #
# clone_repo
# --------------------------------------------------------------------------- #
class _FakeProc:
    def __init__(self, returncode=0, stderr="", stdout=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = stdout


def test_clone_repo_success_on_branch(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return _FakeProc(returncode=0)

    monkeypatch.setattr(svc.subprocess, "run", fake_run)
    dest = tmp_path / "repo"
    svc.clone_repo("https://github.com/x/y.git", "main", dest)
    # only the branch attempt should have run (returned on first success)
    assert len(calls) == 1
    assert "--branch" in calls[0]


def test_clone_repo_fallback_then_failure(monkeypatch, tmp_path):
    dest = tmp_path / "repo"

    def fake_run(cmd, **kw):
        # simulate git leaving a partial dir behind so the rmtree branch runs
        dest.mkdir(parents=True, exist_ok=True)
        return _FakeProc(returncode=128, stderr="fatal: boom")

    monkeypatch.setattr(svc.subprocess, "run", fake_run)
    with pytest.raises(RuntimeError) as ei:
        svc.clone_repo("https://github.com/x/y.git", "main", dest)
    assert "git clone failed" in str(ei.value)
    assert not dest.exists()  # cleaned up after the failed attempt


def test_clone_repo_no_branch(monkeypatch, tmp_path):
    calls = []

    def fake_run(cmd, **kw):
        calls.append(cmd)
        return _FakeProc(returncode=0)

    monkeypatch.setattr(svc.subprocess, "run", fake_run)
    svc.clone_repo("https://github.com/x/y.git", None, tmp_path / "repo")
    assert len(calls) == 1
    assert "--branch" not in calls[0]


# --------------------------------------------------------------------------- #
# run_extract
# --------------------------------------------------------------------------- #
class _FakePopen:
    def __init__(self, lines, returncode=0, wait_raises=None):
        self.stdout = iter([l + "\n" for l in lines])
        self.returncode = returncode
        self._wait_raises = wait_raises
        self.killed = False

    def wait(self, timeout=None):
        if self._wait_raises:
            raise self._wait_raises
        return self.returncode

    def kill(self):
        self.killed = True


def test_run_extract_success_streams_lines(monkeypatch, tmp_path):
    seen = []

    def fake_popen(cmd, **kw):
        return _FakePopen(["line one", "chunk 1/2", "done"], returncode=0)

    monkeypatch.setattr(svc.subprocess, "Popen", fake_popen)
    out = svc.run_extract(tmp_path, tmp_path / "out", "deepseek", on_line=seen.append)
    assert "line one" in out and "done" in out
    assert seen == ["line one", "chunk 1/2", "done"]


def test_run_extract_on_line_exception_swallowed(monkeypatch, tmp_path):
    def fake_popen(cmd, **kw):
        return _FakePopen(["x"], returncode=0)

    def boom(_):
        raise ValueError("nope")

    monkeypatch.setattr(svc.subprocess, "Popen", fake_popen)
    # should not raise even though on_line throws (lines 148-150)
    out = svc.run_extract(tmp_path, tmp_path / "out", "deepseek", on_line=boom)
    assert out == "x"


def test_run_extract_nonzero_returncode_raises(monkeypatch, tmp_path):
    def fake_popen(cmd, **kw):
        return _FakePopen(["boom err"], returncode=1)

    monkeypatch.setattr(svc.subprocess, "Popen", fake_popen)
    with pytest.raises(RuntimeError) as ei:
        svc.run_extract(tmp_path, tmp_path / "out", "deepseek")
    assert "graphify extract failed" in str(ei.value)


def test_run_extract_timeout_kills(monkeypatch, tmp_path):
    timeout = subprocess.TimeoutExpired(cmd="x", timeout=1)

    def fake_popen(cmd, **kw):
        return _FakePopen(["x"], returncode=0, wait_raises=timeout)

    monkeypatch.setattr(svc.subprocess, "Popen", fake_popen)
    with pytest.raises(subprocess.TimeoutExpired):
        svc.run_extract(tmp_path, tmp_path / "out", "deepseek")


# --------------------------------------------------------------------------- #
# parse_progress / _scrub / parse_stats
# --------------------------------------------------------------------------- #
def test_parse_progress_semantic(monkeypatch):
    st = {}
    svc.parse_progress("[graphify] running semantic extraction on 12 files", st)
    assert st["phase"] == "extracting" and st["semanticFiles"] == 12
    assert st["percent"] >= 20


def test_scrub_removes_tokens(monkeypatch):
    monkeypatch.setattr(svc, "GITHUB_TOKEN", "ghp_secret123")
    text = "cloning https://x-access-token:ghp_secret123@github.com/o/r.git failed"
    out = svc._scrub(text)
    assert "ghp_secret123" not in out
    assert "x-access-token:***@" in out


def test_parse_stats_no_match():
    assert svc.parse_stats("nothing to see here") == {}
    assert svc.parse_stats("") == {}


# --------------------------------------------------------------------------- #
# load_graph / load_report
# --------------------------------------------------------------------------- #
def test_load_graph_missing_raises(tmp_path):
    with pytest.raises(RuntimeError) as ei:
        svc.load_graph(tmp_path)
    assert "no graph.json" in str(ei.value)


def test_load_graph_normalizes_links_to_edges(tmp_path):
    (tmp_path / "graph.json").write_text(json.dumps(FIXTURE_GRAPH), encoding="utf-8")
    data = svc.load_graph(tmp_path)
    assert data["edges"] == data["links"]


def test_load_report_present_and_absent(tmp_path):
    assert svc.load_report(tmp_path) is None
    (tmp_path / "GRAPH_REPORT.md").write_text("# report", encoding="utf-8")
    assert svc.load_report(tmp_path) == "# report"


# --------------------------------------------------------------------------- #
# merge_graph edge cases
# --------------------------------------------------------------------------- #
def test_merge_graph_skips_nondict_and_bad_community():
    combined = {"directed": True, "nodes": [], "links": []}
    g = {
        "nodes": [
            "not-a-dict",                       # skipped (line 257)
            {"id": "a", "community": "oops"},   # bad community -> except (266-267)
            {"id": "b", "community": 1},
        ],
        "links": [
            "not-a-dict",                       # skipped (line 271)
            {"source": "a", "target": "b"},
            {"source": {"id": "a"}, "target": {"id": "b"}},  # dict endpoints
        ],
    }
    base = svc.merge_graph(combined, g, "repo", 0)
    ids = {n["id"] for n in combined["nodes"]}
    assert ids == {"repo::a", "repo::b"}
    # 'a' kept its (unparseable) community string; 'b' offset to base+1
    assert base == 2
    assert len(combined["links"]) == 2


# --------------------------------------------------------------------------- #
# /analyze endpoint branches
# --------------------------------------------------------------------------- #
def _mk_extract(graph=FIXTURE_GRAPH, stdout="tokens: 100 in / 50 out, est. cost (~deepseek): $0.0001"):
    def fake_extract(scan_root: Path, out_dir: Path, backend: str, on_line=None):
        gdir = out_dir / "graphify-out"
        gdir.mkdir(parents=True, exist_ok=True)
        (gdir / "graph.json").write_text(json.dumps(graph), encoding="utf-8")
        if on_line:
            on_line("found 53 code, 4 docs")
            on_line("chunk 1/1 done")
            on_line("wrote out/graph.json: 3 nodes, 2 edges, 2 communities")
        return stdout
    return fake_extract


def _fake_clone(url, branch, dest: Path):
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "README.md").write_text("hi", encoding="utf-8")


def test_analyze_unauthorized(monkeypatch):
    monkeypatch.setattr(svc, "AUTH_TOKEN", "sekret")
    r = client.post(
        "/analyze",
        json={"repos": [{"name": "x", "githubFullName": "fusionsoftlabsops/r"}]},
    )
    assert r.status_code == 401


def test_analyze_authorized_with_token(monkeypatch):
    monkeypatch.setattr(svc, "AUTH_TOKEN", "sekret")
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "clone_repo", _fake_clone)
    monkeypatch.setattr(svc, "run_extract", _mk_extract())
    r = client.post(
        "/analyze",
        headers={"Authorization": "Bearer sekret"},
        json={"repos": [{"name": "web", "githubFullName": "fusionsoftlabsops/idea-forge-web"}]},
    )
    assert r.status_code == 200, r.text


def test_analyze_no_repos():
    r = client.post("/analyze", json={"repos": []})
    assert r.status_code == 400


def test_analyze_too_many_repos(monkeypatch):
    monkeypatch.setattr(svc, "MAX_REPOS", 1)
    r = client.post(
        "/analyze",
        json={"repos": [
            {"name": "a", "githubFullName": "fusionsoftlabsops/a"},
            {"name": "b", "githubFullName": "fusionsoftlabsops/b"},
        ]},
    )
    assert r.status_code == 400
    assert "too many repos" in r.json()["detail"]


def test_analyze_with_jobid_tracks_progress(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "clone_repo", _fake_clone)
    monkeypatch.setattr(svc, "run_extract", _mk_extract())
    r = client.post(
        "/analyze",
        json={
            "jobId": "job-123",
            "repos": [{"name": "web", "githubFullName": "fusionsoftlabsops/idea-forge-web"}],
        },
    )
    assert r.status_code == 200, r.text
    # progress was tracked & ended in "done"
    p = client.get("/progress/job-123")
    assert p.status_code == 200
    assert p.json()["phase"] == "done"
    assert p.json()["percent"] == 100


def test_analyze_clone_failure_returns_502(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})

    def boom_clone(url, branch, dest):
        raise RuntimeError("git clone failed: nope")

    monkeypatch.setattr(svc, "clone_repo", boom_clone)
    r = client.post(
        "/analyze",
        json={"repos": [{"name": "web", "githubFullName": "fusionsoftlabsops/idea-forge-web"}]},
    )
    assert r.status_code == 502
    assert "clone of" in r.json()["detail"]


def test_analyze_extract_timeout_all_fail_returns_500(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "clone_repo", _fake_clone)

    def timeout_extract(scan_root, out_dir, backend, on_line=None):
        raise subprocess.TimeoutExpired(cmd="x", timeout=1)

    monkeypatch.setattr(svc, "run_extract", timeout_extract)
    r = client.post(
        "/analyze",
        json={
            "jobId": "job-timeout",
            "repos": [{"name": "web", "githubFullName": "fusionsoftlabsops/idea-forge-web"}],
        },
    )
    assert r.status_code == 500
    assert "all repos failed" in r.json()["detail"]
    assert client.get("/progress/job-timeout").json()["phase"] == "failed"


def test_analyze_extract_exception_all_fail(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "clone_repo", _fake_clone)

    def bad_extract(scan_root, out_dir, backend, on_line=None):
        # produce no graph.json so load_graph raises inside the except branch
        return "tokens: nope"

    monkeypatch.setattr(svc, "run_extract", bad_extract)
    r = client.post(
        "/analyze",
        json={"repos": [{"name": "web", "githubFullName": "fusionsoftlabsops/idea-forge-web"}]},
    )
    assert r.status_code == 500
    assert "all repos failed" in r.json()["detail"]


def test_analyze_extract_listing_failed_branch(monkeypatch):
    # graphify-out exists but is a FILE, so .iterdir() raises -> "(listing failed)"
    # (lines 359-360), and load_graph still fails -> repo skipped, all fail -> 500.
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "clone_repo", _fake_clone)

    def file_extract(scan_root, out_dir, backend, on_line=None):
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "graphify-out").write_text("not a dir", encoding="utf-8")
        return "tokens: 1 in / 1 out"

    monkeypatch.setattr(svc, "run_extract", file_extract)
    r = client.post(
        "/analyze",
        json={"repos": [{"name": "web", "githubFullName": "fusionsoftlabsops/idea-forge-web"}]},
    )
    assert r.status_code == 500
    assert "all repos failed" in r.json()["detail"]


def test_analyze_partial_success_reports_skipped(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "clone_repo", _fake_clone)

    good = _mk_extract()

    def mixed_extract(scan_root, out_dir, backend, on_line=None):
        # the second repo's clone dir is r1; fail it, succeed otherwise
        if scan_root.name == "r1":
            raise RuntimeError("extract blew up")
        return good(scan_root, out_dir, backend, on_line)

    monkeypatch.setattr(svc, "run_extract", mixed_extract)
    r = client.post(
        "/analyze",
        json={"repos": [
            {"name": "ok", "githubFullName": "fusionsoftlabsops/ok"},
            {"name": "bad", "githubFullName": "fusionsoftlabsops/bad"},
        ]},
    )
    assert r.status_code == 200, r.text
    stats = r.json()["stats"]
    assert stats["nodes"] == 3
    assert "skipped" in stats and any("bad" in s for s in stats["skipped"])
