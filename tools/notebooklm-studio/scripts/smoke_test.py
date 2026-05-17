#!/usr/bin/env python3
"""Offline smoke tests for the NotebookLM Studio skill helper scripts."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"


def run(args: list[str], expect: int | None = 0) -> subprocess.CompletedProcess[str]:
    proc = subprocess.run(args, capture_output=True, text=True, check=False)
    if expect is not None and proc.returncode != expect:
        raise AssertionError(
            f"command failed ({proc.returncode}): {' '.join(args)}\nSTDOUT:\n{proc.stdout}\nSTDERR:\n{proc.stderr}"
        )
    return proc


def test_manifest() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        sample = Path(tmp) / "brief.md"
        sample.write_text("# Brief\n\nNotebookLM smoke test source.\n", encoding="utf-8")
        proc = run(
            [
                sys.executable,
                str(SCRIPTS / "source_manifest.py"),
                str(sample),
                "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "https://example.com/report",
            ],
            expect=0,
        )
    payload = json.loads(proc.stdout)
    kinds = {entry["kind"] for entry in payload["sources"]}
    assert {"document-file", "youtube-url", "web-url"}.issubset(kinds)
    assert payload["supported_count"] == 3


def test_plan() -> None:
    proc = run(
        [
            sys.executable,
            str(SCRIPTS / "nblm_orchestrator.py"),
            "plan",
            "--notebook-title",
            "Smoke Test",
            "--source",
            "https://example.com/report",
            "--artifact",
            "audio",
            "--artifact",
            "data-table",
            "--download",
            "--out-dir",
            "outputs",
        ],
        expect=0,
    )
    payload = json.loads(proc.stdout)
    commands = "\n".join(step["command_text"] for step in payload["steps"])
    assert "notebooklm create" in commands
    assert "generate audio" in commands
    assert "generate data-table" in commands
    assert "download audio" in commands
    assert "--timeout" not in commands


def test_pipeline_plan() -> None:
    proc = run(
        [
            sys.executable,
            str(SCRIPTS / "artifact_pipeline.py"),
            "plan",
            "--notebook-title",
            "Smoke Test",
            "--source",
            "https://example.com/report",
            "--artifact",
            "audio",
            "--artifact",
            "mind-map",
            "--artifact",
            "slide-deck",
            "--download",
            "--download-slide-format",
            "both",
            "--out-dir",
            "outputs",
        ],
        expect=0,
    )
    payload = json.loads(proc.stdout)
    commands = "\n".join(job["submit_command"] or "" for job in payload["jobs"])
    downloads = "\n".join("\n".join(job["download_commands"]) for job in payload["jobs"])
    assert "generate audio" in commands
    assert "--no-wait" in commands
    assert "generate mind-map" in commands
    assert "download slide-deck" in downloads
    assert "--format pdf" in downloads
    assert "--format pptx" in downloads


def test_mindmap_html() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        mindmap = Path(tmp) / "mind-map.json"
        output = Path(tmp) / "mind-map.html"
        mindmap.write_text(
            json.dumps(
                {
                    "name": "Root",
                    "children": [
                        {"name": "Branch A", "children": [{"name": "Leaf"}]},
                        {"name": "Branch B"},
                    ],
                }
            ),
            encoding="utf-8",
        )
        proc = run(
            [
                sys.executable,
                str(SCRIPTS / "mindmap_html.py"),
                str(mindmap),
                "-o",
                str(output),
                "--json",
            ],
            expect=0,
        )
        payload = json.loads(proc.stdout)
        assert payload["node_count"] == 4
        html = output.read_text(encoding="utf-8")
        assert "Root" in html
        assert "Search nodes" in html


def test_environment_check() -> None:
    proc = run([sys.executable, str(SCRIPTS / "validate_environment.py"), "--json"], expect=0)
    payload = json.loads(proc.stdout)
    assert "ready_for_notebooklm" in payload
    assert "needs" in payload


def test_bootstrap() -> None:
    proc = run([sys.executable, str(SCRIPTS / "bootstrap_notebooklm.py"), "--json", "--print-guide"], expect=0)
    assert "NotebookLM Studio Setup Result" in proc.stdout
    assert "ready_for_notebooklm" in proc.stdout


def test_dashboard() -> None:
    proc = run([sys.executable, str(SCRIPTS / "dashboard_smoke_test.py")], expect=0)
    assert "dashboard smoke tests passed" in proc.stdout


def main() -> int:
    test_manifest()
    test_plan()
    test_pipeline_plan()
    test_mindmap_html()
    test_environment_check()
    test_bootstrap()
    test_dashboard()
    print("offline smoke tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
