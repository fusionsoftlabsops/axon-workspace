"""Tests for graphify-svc. The clone + extract steps are monkeypatched so the
suite runs offline with no git/network/LLM — it verifies the endpoint wiring,
the org allowlist, and the stats parsing."""

import json
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


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["service"] == "graphify-svc"


def test_resolve_repo_allowlist(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    url, full = svc.resolve_repo(svc.RepoIn(name="x", githubFullName="fusionsoftlabsops/idea-forge-web"))
    assert full == "fusionsoftlabsops/idea-forge-web"
    assert url.endswith("fusionsoftlabsops/idea-forge-web.git")
    with pytest.raises(Exception):
        svc.resolve_repo(svc.RepoIn(name="x", githubFullName="someoneelse/repo"))


def test_resolve_repo_honors_authenticated_clone_url(monkeypatch):
    # When the caller (Axon) supplies an already-authenticated URL, use it as-is
    # (so the service needs no token of its own) — but still enforce the allowlist.
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    monkeypatch.setattr(svc, "GITHUB_TOKEN", "")
    authed = "https://x-access-token:ghp_abc@github.com/fusionsoftlabsops/idea-forge-web.git"
    url, full = svc.resolve_repo(svc.RepoIn(name="web", cloneUrl=authed))
    assert url == authed
    assert full == "fusionsoftlabsops/idea-forge-web"


def test_parse_stats():
    line = "tokens: 43,356 in / 7,443 out, est. cost (~deepseek): $0.0082"
    s = svc.parse_stats(line)
    assert s == {"tokensIn": 43356, "tokensOut": 7443, "costUsd": 0.0082}


def test_summarize_graph():
    s = svc.summarize_graph(FIXTURE_GRAPH)
    assert s == {"nodes": 3, "edges": 2, "communities": 2}


def test_analyze_happy_path(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})

    def fake_clone(url, branch, dest: Path):
        dest.mkdir(parents=True, exist_ok=True)
        (dest / "README.md").write_text("hi", encoding="utf-8")

    def fake_extract(scan_root: Path, out_dir: Path, backend: str, on_line=None) -> str:
        # graphify writes under <out_dir>/graphify-out/ (extract --out behavior)
        gdir = out_dir / "graphify-out"
        gdir.mkdir(parents=True, exist_ok=True)
        (gdir / "graph.json").write_text(json.dumps(FIXTURE_GRAPH), encoding="utf-8")
        return "tokens: 100 in / 50 out, est. cost (~deepseek): $0.0001"

    monkeypatch.setattr(svc, "clone_repo", fake_clone)
    monkeypatch.setattr(svc, "run_extract", fake_extract)

    r = client.post(
        "/analyze",
        json={"repos": [{"name": "web", "githubFullName": "fusionsoftlabsops/idea-forge-web"}]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["stats"]["nodes"] == 3
    assert body["stats"]["edges"] == 2
    assert body["stats"]["communities"] == 2
    assert body["stats"]["costUsd"] == 0.0001
    assert body["graph"]["edges"]  # normalized from links
    assert body["report"] is None  # per-repo merge has no single report
    # node ids are namespaced by repo to avoid cross-repo collisions
    assert all("::" in n["id"] for n in body["graph"]["nodes"])


def test_parse_progress():
    st = {}
    svc.parse_progress("[graphify extract] found 53 code, 4 docs", st)
    assert st["phase"] == "extracting" and st["codeFiles"] == 53
    svc.parse_progress("[graphify extract] chunk 3/4 done", st)
    assert st["chunksDone"] == 3 and st["chunksTotal"] == 4
    assert 20 < st["percent"] < 95
    svc.parse_progress("[graphify] Deduplicated 53 node(s).", st)
    assert st["phase"] == "building"
    svc.parse_progress("[graphify extract] wrote out/graph.json: 542 nodes, 503 edges, 47 communities", st)
    assert st["phase"] == "done" and st["percent"] == 100 and st["nodes"] == 542 and st["edges"] == 503


def test_merge_graph_namespaces_and_offsets():
    combined = {"directed": True, "nodes": [], "links": []}
    g1 = {"nodes": [{"id": "a", "community": 0}, {"id": "b", "community": 1}],
          "links": [{"source": "a", "target": "b"}]}
    g2 = {"nodes": [{"id": "a", "community": 0}], "links": []}
    base = svc.merge_graph(combined, g1, "backend", 0)
    assert base == 2  # communities 0,1 → next free is 2
    base = svc.merge_graph(combined, g2, "web", base)
    ids = {n["id"] for n in combined["nodes"]}
    assert ids == {"backend::a", "backend::b", "web::a"}  # no collision on 'a'
    # web's community 0 offset to 2 (distinct from backend's 0)
    web_a = next(n for n in combined["nodes"] if n["id"] == "web::a")
    assert web_a["community"] == 2
    assert combined["links"][0] == {"source": "backend::a", "target": "backend::b"}


def test_progress_endpoint_unknown():
    r = client.get("/progress/nope")
    assert r.status_code == 200 and r.json()["phase"] == "unknown"


def test_analyze_rejects_disallowed_org(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    r = client.post("/analyze", json={"repos": [{"name": "x", "githubFullName": "evil/repo"}]})
    assert r.status_code == 403
