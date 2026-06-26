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

    def fake_extract(scan_root: Path, out_dir: Path, backend: str) -> str:
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "graph.json").write_text(json.dumps(FIXTURE_GRAPH), encoding="utf-8")
        (out_dir / "GRAPH_REPORT.md").write_text("# Report", encoding="utf-8")
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
    assert body["report"].startswith("# Report")


def test_analyze_rejects_disallowed_org(monkeypatch):
    monkeypatch.setattr(svc, "ALLOWED_ORGS", {"fusionsoftlabsops"})
    r = client.post("/analyze", json={"repos": [{"name": "x", "githubFullName": "evil/repo"}]})
    assert r.status_code == 403
