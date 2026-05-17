#!/usr/bin/env python3
"""Offline smoke tests for the NotebookLM Studio dashboard helper."""

from __future__ import annotations

import importlib.util
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_dashboard_module():
    spec = importlib.util.spec_from_file_location("dashboard_server", ROOT / "scripts" / "dashboard_server.py")
    if spec is None or spec.loader is None:
        raise AssertionError("Unable to load dashboard server module")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_dashboard_assets_exist() -> None:
    assert (ROOT / "dashboard" / "index.html").exists()
    assert (ROOT / "dashboard" / "app.js").exists()
    assert (ROOT / "dashboard" / "styles.css").exists()
    assert (ROOT / "dashboard" / "assets" / "NotebookLM_logo.png").exists()
    app_js = (ROOT / "dashboard" / "app.js").read_text(encoding="utf-8")
    assert "Show Prompt for Codex" in app_js
    assert "data:image" not in app_js


def test_prepare_agent_prompt_writes_text_prompt() -> None:
    dashboard = load_dashboard_module()
    with tempfile.TemporaryDirectory() as tmp:
        dashboard.OUTPUT_ROOT = Path(tmp) / "dashboard"
        dashboard.JOBS.clear()
        dashboard.CACHE.clear()
        dashboard.PERSISTED_JOBS_LOADED = True
        job = {
            "id": "job-test",
            "notebook_id": "nb-test",
            "notebook_title": "Taiwan Banking AI Visibility Analysis",
            "label": "Executive Briefing Suite",
            "purpose": "Analyze banking AI visibility outputs",
            "kind": "recipe",
            "artifacts": ["Report"],
            "commands": ["report"],
            "status": "completed",
            "created_at": "2026-05-16T00:00:00",
            "updated_at": "2026-05-16T00:01:00",
            "outputs": [
                {
                    "command": "report",
                    "label": "Report",
                    "status": "completed",
                    "artifact_id": "artifact-test",
                    "download_status": "downloaded",
                    "downloaded_files": [
                        {
                            "path": "/tmp/taiwan-banking-report.md",
                            "size": 1234,
                            "format": "md",
                        }
                    ],
                }
            ],
        }
        dashboard.JOBS.append(job)

        result = dashboard.prepare_agent_prompt("job-test")
        assert result["ok"] is True
        assert result["prompt"].strip().startswith("Analyze the following NotebookLM generated outputs")
        assert "data:image" not in result["prompt"]
        assert result["prompt_path"].endswith("latest_agent_prompt.md")

        prompt_path = Path(result["prompt_path"])
        assert prompt_path.exists()
        assert prompt_path.read_text(encoding="utf-8").strip() == result["prompt"].strip()


def test_prepare_agent_prompt_requires_downloaded_files() -> None:
    dashboard = load_dashboard_module()
    with tempfile.TemporaryDirectory() as tmp:
        dashboard.OUTPUT_ROOT = Path(tmp) / "dashboard"
        dashboard.JOBS.clear()
        dashboard.CACHE.clear()
        dashboard.PERSISTED_JOBS_LOADED = True
        dashboard.JOBS.append(
            {
                "id": "job-empty",
                "notebook_id": "nb-test",
                "notebook_title": "No Downloads",
                "status": "completed",
                "outputs": [{"label": "Report", "status": "completed", "downloaded_files": []}],
            }
        )

        result = dashboard.prepare_agent_prompt("job-empty")
        assert result["ok"] is False
        assert result["error"] == "No downloaded files are ready yet"


def main() -> int:
    test_dashboard_assets_exist()
    test_prepare_agent_prompt_writes_text_prompt()
    test_prepare_agent_prompt_requires_downloaded_files()
    print("dashboard smoke tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
