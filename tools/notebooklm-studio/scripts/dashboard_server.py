#!/usr/bin/env python3
"""Local dashboard for NotebookLM Studio.

The dashboard reads NotebookLM metadata through the local `notebooklm` CLI and
submits real artifact generation jobs from the UI. Jobs run in background
threads so the browser can poll status without blocking.
"""

from __future__ import annotations

import argparse
import errno
import json
import mimetypes
import os
import re
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_ROOT = ROOT / "dashboard"
OUTPUT_ROOT = Path.cwd() / "notebooklm_outputs" / "dashboard"
NOTEBOOKLM_PROFILE = os.environ.get("NOTEBOOKLM_PROFILE", "default")
JOBS: list[dict[str, Any]] = []
CACHE: dict[str, tuple[float, Any]] = {}
JOB_LOCK = threading.Lock()
PERSISTED_JOBS_LOADED = False

TERMINAL_STATUSES = {"completed", "failed", "submit_failed", "not_found"}


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def slugify(value: str, fallback: str = "notebook") -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff]+", "-", value.strip(), flags=re.UNICODE)
    cleaned = re.sub(r"-+", "-", cleaned).strip("-")
    return (cleaned or fallback)[:80]


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def notebook_folder(job: dict[str, Any]) -> Path:
    notebook_id = str(job.get("notebook_id") or "unknown")
    title = str(job.get("notebook_title") or "Untitled notebook")
    return OUTPUT_ROOT / f"{slugify(title)}-{notebook_id[:8]}"


def run_notebooklm(args: list[str], timeout: int = 45) -> dict[str, Any]:
    command = ["notebooklm"]
    if NOTEBOOKLM_PROFILE:
        command.extend(["-p", NOTEBOOKLM_PROFILE])
    command.extend(args)
    proc = subprocess.run(
        command,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )
    payload = None
    if proc.stdout.strip():
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError:
            payload = proc.stdout.strip()
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": payload,
        "stderr": proc.stderr.strip(),
    }


def cached(key: str, ttl: int, producer):
    now = time.time()
    hit = CACHE.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = producer()
    CACHE[key] = (now, value)
    return value


def artifact_kind(type_id: str) -> str:
    return {
        "audio": "audio",
        "video": "video",
        "report": "report",
        "slide_deck": "slides",
        "mind_map": "mind-map",
        "data_table": "table",
        "quiz": "quiz",
        "flashcard": "flashcards",
        "infographic": "infographic",
    }.get(type_id, type_id or "unknown")


def command_config(command: str, notebook_id: str) -> dict[str, Any] | None:
    configs = {
        "audio": {
            "label": "Audio Overview",
            "type_id": "audio",
            "args": [
                "generate",
                "audio",
                "Create a clear executive audio overview from this notebook.",
                "-n",
                notebook_id,
                "--format",
                "deep-dive",
                "--length",
                "default",
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
        "video": {
            "label": "Video Overview",
            "type_id": "video",
            "args": [
                "generate",
                "video",
                "Create a concise narrated visual overview of the notebook.",
                "-n",
                notebook_id,
                "--format",
                "explainer",
                "--style",
                "classic",
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
        "report": {
            "label": "Report",
            "type_id": "report",
            "args": [
                "generate",
                "report",
                "-n",
                notebook_id,
                "--format",
                "briefing-doc",
                "--append",
                "Write in English unless the user explicitly asks for another language. Focus on the key findings, risks, opportunities, and evidence.",
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
        "slide-deck": {
            "label": "Slide Deck",
            "type_id": "slide_deck",
            "args": [
                "generate",
                "slide-deck",
                "Create a presentation-ready slide deck with concise headings and clear structure.",
                "-n",
                notebook_id,
                "--format",
                "presenter",
                "--length",
                "default",
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
        "mind-map": {
            "label": "Mind Map",
            "type_id": "mind_map",
            "args": [
                "generate",
                "mind-map",
                "-n",
                notebook_id,
                "--instructions",
                "Create a clear map of core concepts, relationships, evidence, risks, and next questions.",
                "--json",
            ],
        },
        "data-table": {
            "label": "Data Table",
            "type_id": "data_table",
            "args": [
                "generate",
                "data-table",
                "Create a structured table of key entities, findings, evidence, risks, opportunities, and recommended next actions.",
                "-n",
                notebook_id,
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
        "quiz": {
            "label": "Quiz",
            "type_id": "quiz",
            "args": [
                "generate",
                "quiz",
                "Test the most important concepts and facts in this notebook.",
                "-n",
                notebook_id,
                "--quantity",
                "standard",
                "--difficulty",
                "medium",
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
        "flashcards": {
            "label": "Flashcards",
            "type_id": "flashcard",
            "args": [
                "generate",
                "flashcards",
                "Create concise flashcards for key terms, concepts, people, events, and evidence.",
                "-n",
                notebook_id,
                "--quantity",
                "standard",
                "--difficulty",
                "medium",
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
        "infographic": {
            "label": "Infographic",
            "type_id": "infographic",
            "args": [
                "generate",
                "infographic",
                "Create a professional infographic highlighting the most important findings and relationships.",
                "-n",
                notebook_id,
                "--orientation",
                "landscape",
                "--detail",
                "standard",
                "--style",
                "professional",
                "--no-wait",
                "--retry",
                "2",
                "--json",
            ],
        },
    }
    return configs.get(command)


def list_artifacts(notebook_id: str) -> list[dict[str, Any]]:
    result = run_notebooklm(["artifact", "list", "-n", notebook_id, "--type", "all", "--json"], timeout=60)
    if not result["ok"] or not isinstance(result["stdout"], dict):
        return []
    return result["stdout"].get("artifacts", [])


def output_specs(type_id: str, artifact_title: str) -> list[dict[str, Any]]:
    base = slugify(artifact_title, fallback=type_id)
    specs = {
        "audio": [{"folder": "audio", "filename": f"{base}.mp3", "args": []}],
        "video": [{"folder": "video", "filename": f"{base}.mp4", "args": []}],
        "report": [{"folder": "reports", "filename": f"{base}.md", "args": ["--json", "--force"]}],
        "slide_deck": [
            {"folder": "slides", "filename": f"{base}.pdf", "args": ["--format", "pdf", "--json", "--force"]},
            {"folder": "slides", "filename": f"{base}.pptx", "args": ["--format", "pptx", "--json", "--force"]},
        ],
        "data_table": [{"folder": "tables", "filename": f"{base}.csv", "args": ["--json", "--force"]}],
        "mind_map": [{"folder": "mind-maps", "filename": f"{base}.json", "args": ["--json", "--force"]}],
        "infographic": [{"folder": "infographics", "filename": f"{base}.png", "args": ["--json", "--force"]}],
        "quiz": [
            {"folder": "quizzes", "filename": f"{base}.json", "args": ["--format", "json"]},
            {"folder": "quizzes", "filename": f"{base}.md", "args": ["--format", "markdown"]},
        ],
        "flashcard": [
            {"folder": "flashcards", "filename": f"{base}.json", "args": ["--format", "json"]},
            {"folder": "flashcards", "filename": f"{base}.md", "args": ["--format", "markdown"]},
        ],
    }
    return specs.get(type_id, [{"folder": "artifacts", "filename": base, "args": []}])


def download_command(type_id: str) -> str:
    return {
        "slide_deck": "slide-deck",
        "data_table": "data-table",
        "mind_map": "mind-map",
        "flashcard": "flashcards",
    }.get(type_id, type_id)


def download_artifact(job: dict[str, Any], output: dict[str, Any]) -> None:
    artifact_id = output.get("artifact_id")
    notebook_id = str(job.get("notebook_id") or "")
    if not artifact_id or output.get("download_status") == "downloaded":
        return

    type_id = str(output.get("type_id") or "").lower()
    artifact_title = str(output.get("title") or output.get("label") or type_id)
    notebook_dir = notebook_folder(job)
    downloaded = []
    errors = []

    for spec in output_specs(type_id, artifact_title):
        destination = notebook_dir / spec["folder"] / spec["filename"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        args = [
            "download",
            download_command(type_id),
            "-n",
            notebook_id,
            "-a",
            str(artifact_id),
            *spec["args"],
            str(destination),
        ]
        result = run_notebooklm(args, timeout=240)
        if result["ok"] and destination.exists():
            downloaded.append(
                {
                    "path": str(destination),
                    "size": destination.stat().st_size,
                    "format": destination.suffix.lstrip("."),
                    "result": result["stdout"],
                }
            )
        else:
            errors.append({"path": str(destination), "error": result["stderr"] or result["stdout"]})

    output["downloaded_files"] = downloaded
    output["download_errors"] = errors
    output["download_status"] = "downloaded" if downloaded and not errors else "download_failed" if errors else "skipped"
    update_job_files(job)


def update_job_files(job: dict[str, Any]) -> None:
    folder = notebook_folder(job)
    folder.mkdir(parents=True, exist_ok=True)
    manifest = {
        "notebook_id": job.get("notebook_id"),
        "notebook_title": job.get("notebook_title"),
        "job_id": job.get("id"),
        "label": job.get("label"),
        "purpose": job.get("purpose"),
        "kind": job.get("kind"),
        "artifacts": job.get("artifacts") or [],
        "commands": job.get("commands") or [],
        "status": job.get("status"),
        "created_at": job.get("created_at"),
        "updated_at": job.get("updated_at"),
        "outputs": job.get("outputs") or [],
    }
    handoff = {
        **manifest,
        "handoff_ready": any(item.get("downloaded_files") for item in job.get("outputs") or []),
        "instruction": "Ask Codex: analyze the latest generated outputs",
    }
    write_json(folder / "manifest.json", manifest)
    write_json(folder / "latest_job.json", manifest)
    write_json(folder / "latest_handoff.json", handoff)
    job["output_dir"] = str(folder)
    job["handoff_path"] = str(folder / "latest_handoff.json")


def load_persisted_jobs() -> None:
    global PERSISTED_JOBS_LOADED
    if PERSISTED_JOBS_LOADED:
        return
    PERSISTED_JOBS_LOADED = True
    if not OUTPUT_ROOT.exists():
        return
    restored = []
    for path in OUTPUT_ROOT.glob("*/latest_job.json"):
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        job_id = manifest.get("job_id")
        if not job_id:
            continue
        outputs = manifest.get("outputs") or []
        restored.append(
            {
                "id": job_id,
                "notebook_id": manifest.get("notebook_id"),
                "notebook_title": manifest.get("notebook_title"),
                "label": manifest.get("label"),
                "purpose": manifest.get("purpose"),
                "kind": manifest.get("kind"),
                "artifacts": manifest.get("artifacts") or [item.get("label") for item in outputs if item.get("label")],
                "commands": manifest.get("commands") or [item.get("command") for item in outputs if item.get("command")],
                "outputs": outputs,
                "status": manifest.get("status") or "completed",
                "created_at": manifest.get("created_at"),
                "updated_at": manifest.get("updated_at"),
                "steps": [
                    {
                        "name": f"{item.get('label') or item.get('command')}: {item.get('status')}",
                        "status": "done" if item.get("status") == "completed" else "failed" if item.get("status") == "failed" else "waiting",
                    }
                    for item in outputs
                ],
                "progress": 100 if manifest.get("status") in {"completed", "completed with failures"} else 45,
                "preview": False,
                "output_dir": str(path.parent),
                "handoff_path": str(path.parent / "latest_handoff.json"),
            }
        )
    with JOB_LOCK:
        known_ids = {job.get("id") for job in JOBS}
        for job in restored:
            if job.get("id") not in known_ids:
                JOBS.append(job)


def build_agent_prompt(handoff: dict[str, Any]) -> str:
    outputs = handoff.get("outputs") or []
    files = []
    for output in outputs:
        for file_item in output.get("downloaded_files") or []:
            files.append(
                {
                    "artifact": output.get("label") or output.get("type") or output.get("command"),
                    "title": output.get("title"),
                    "artifact_id": output.get("artifact_id"),
                    "format": file_item.get("format"),
                    "path": file_item.get("path"),
                    "size": file_item.get("size"),
                }
            )
    file_lines = "\n".join(
        f"- [{Path(str(item.get('path') or '')).name}]({item.get('path')}) "
        f"- {item['artifact']} / {item.get('format') or 'file'} "
        f"(title: {item.get('title') or 'n/a'}, artifact_id: {item.get('artifact_id') or 'n/a'})"
        for item in files
    ) or "- No downloaded files were found."
    output_lines = "\n".join(
        f"- {output.get('label') or output.get('command')}: {output.get('status')} "
        f"(artifact_id: {output.get('artifact_id') or 'n/a'}, download: {output.get('download_status') or 'n/a'})"
        for output in outputs
    ) or "- No outputs were recorded."
    return f"""Analyze the following NotebookLM generated outputs in this conversation.

First read the handoff metadata and local files, then complete these tasks:
1. Start with "File Links" and list each file as a Markdown link in the format `[filename](/absolute/path)`.
2. Briefly explain what this generation job did.
3. Summarize the key content in each output file.
4. Provide deeper insights, risks, opportunities, and recommended next steps.
5. If the material is insufficient or source verification is needed, say so clearly.
6. Continue discussing this workflow in English unless the user asks for another language.

Notebook:
- Title: {handoff.get('notebook_title') or 'Untitled notebook'}
- ID: {handoff.get('notebook_id') or 'unknown'}

Job:
- ID: {handoff.get('job_id') or handoff.get('selected_job_id') or 'unknown'}
- Type: {handoff.get('kind') or 'unknown'}
- Workflow / Action: {handoff.get('label') or 'unknown'}
- Workflow purpose: {handoff.get('purpose') or 'Not specified'}
- Requested artifacts: {", ".join(handoff.get('artifacts') or []) or 'unknown'}
- Status: {handoff.get('status') or 'unknown'}
- Created at: {handoff.get('created_at') or 'unknown'}
- Updated at: {handoff.get('updated_at') or 'unknown'}

Outputs:
{output_lines}

Downloaded files:
{file_lines}

Handoff files:
- Notebook handoff: {handoff.get('handoff_path') or 'unknown'}
- Global handoff: {handoff.get('global_handoff_path') or 'not recorded'}

Start the analysis directly. Do not ask me for file paths."""


def prepare_agent_prompt(job_id: str) -> dict[str, Any]:
    load_persisted_jobs()
    with JOB_LOCK:
        job = next((item for item in JOBS if item.get("id") == job_id), None)
    if not job:
        return {"ok": False, "error": "Job not found"}
    outputs = job.get("outputs") or []
    if job.get("status") not in {"completed", "completed with failures"}:
        return {"ok": False, "error": "Job is not complete yet"}
    if not any(item.get("downloaded_files") for item in outputs):
        return {"ok": False, "error": "No downloaded files are ready yet"}
    update_job_files(job)
    folder = notebook_folder(job)
    handoff_path = folder / "latest_handoff.json"
    global_handoff = OUTPUT_ROOT / "latest_handoff.json"
    handoff = json.loads(handoff_path.read_text(encoding="utf-8")) if handoff_path.exists() else {}
    handoff["selected_at"] = now_iso()
    handoff["selected_job_id"] = job_id
    handoff["handoff_path"] = str(handoff_path)
    handoff["global_handoff_path"] = str(global_handoff)
    prompt_path = folder / "latest_agent_prompt.md"
    prompt = build_agent_prompt(handoff)
    handoff["agent_prompt"] = prompt
    handoff["agent_prompt_path"] = str(prompt_path)
    prompt_path.write_text(prompt + "\n", encoding="utf-8")
    write_json(handoff_path, handoff)
    write_json(global_handoff, handoff)
    job["handoff_status"] = "prompt_ready"
    job["handoff_path"] = str(handoff_path)
    job["global_handoff_path"] = str(global_handoff)
    job["agent_prompt_path"] = str(prompt_path)
    return {
        "ok": True,
        "handoff": handoff,
        "prompt": prompt,
        "path": str(handoff_path),
        "global_path": str(global_handoff),
        "prompt_path": str(prompt_path),
    }


def extract_artifact_id(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("artifact_id", "artifactId", "id"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
        for value in payload.values():
            found = extract_artifact_id(value)
            if found:
                return found
    if isinstance(payload, list):
        for item in payload:
            found = extract_artifact_id(item)
            if found:
                return found
    return None


def find_new_artifact(notebook_id: str, before_ids: set[str], type_id: str) -> dict[str, Any] | None:
    artifacts = list_artifacts(notebook_id)
    candidates = [
        item
        for item in artifacts
        if item.get("id") not in before_ids and str(item.get("type_id") or "").lower() == type_id
    ]
    if not candidates:
        return None
    return sorted(candidates, key=lambda item: item.get("created_at") or "", reverse=True)[0]


def set_job(job: dict[str, Any], **updates: Any) -> None:
    with JOB_LOCK:
        job.update(updates)


def refresh_job(job: dict[str, Any]) -> None:
    outputs = job.get("outputs") or []
    total = max(len(outputs), 1)
    completed = sum(1 for item in outputs if item.get("status") == "completed")
    failed = sum(1 for item in outputs if item.get("status") in {"failed", "submit_failed", "not_found"})
    active = sum(1 for item in outputs if item.get("status") not in TERMINAL_STATUSES)
    progress = min(96, 12 + int((completed + failed) / total * 84))
    if completed + failed == total:
        progress = 100
        status = "completed" if failed == 0 else "completed with failures"
    elif active:
        status = "generating"
    else:
        status = "submitting"
    steps = [
        {
            "name": f"{item.get('label')}: {item.get('status')}",
            "status": "done" if item.get("status") == "completed" else "failed" if item.get("status") in {"failed", "submit_failed"} else "active",
        }
        for item in outputs
    ]
    set_job(job, status=status, progress=progress, steps=steps, updated_at=now_iso())
    if job.get("notebook_id"):
        CACHE.pop(f"overview:{job['notebook_id']}", None)
    update_job_files(job)


def run_real_job(job: dict[str, Any]) -> None:
    notebook_id = str(job.get("notebook_id") or "")
    commands = job.get("commands") or []
    outputs = []
    set_job(job, status="submitting", progress=6, updated_at=now_iso())

    for command in commands:
        config = command_config(str(command), notebook_id)
        if not config:
            outputs.append({"command": command, "label": str(command), "status": "submit_failed", "error": "Unsupported artifact type"})
            set_job(job, outputs=outputs)
            refresh_job(job)
            continue

        before_ids = {str(item.get("id")) for item in list_artifacts(notebook_id) if item.get("id")}
        output = {
            "command": command,
            "label": config["label"],
            "type_id": config["type_id"],
            "status": "submitting",
            "artifact_id": None,
        }
        outputs.append(output)
        set_job(job, outputs=outputs)
        refresh_job(job)

        result = run_notebooklm(config["args"], timeout=120)
        if not result["ok"]:
            output["status"] = "submit_failed"
            output["error"] = result["stderr"] or result["stdout"]
            refresh_job(job)
            continue

        artifact_id = extract_artifact_id(result["stdout"])
        artifact = None
        if not artifact_id:
            time.sleep(3)
            artifact = find_new_artifact(notebook_id, before_ids, config["type_id"])
            artifact_id = artifact.get("id") if artifact else None
        output["artifact_id"] = artifact_id
        output["submit_result"] = result["stdout"]
        output["status"] = str((artifact or {}).get("status") or "submitted").lower()
        output["title"] = (artifact or {}).get("title")
        refresh_job(job)

    deadline = time.time() + 3600
    while time.time() < deadline:
        active_outputs = [
            item
            for item in outputs
            if item.get("status") not in TERMINAL_STATUSES and item.get("artifact_id")
        ]
        if not active_outputs:
            break
        artifacts = {str(item.get("id")): item for item in list_artifacts(notebook_id) if item.get("id")}
        for output in active_outputs:
            artifact = artifacts.get(str(output.get("artifact_id")))
            if artifact:
                output["status"] = str(artifact.get("status") or output["status"]).lower()
                output["title"] = artifact.get("title")
                output["created_at"] = artifact.get("created_at")
                output["type"] = artifact.get("type")
                if output["status"] == "completed":
                    download_artifact(job, output)
        refresh_job(job)
        if all(item.get("status") in TERMINAL_STATUSES or not item.get("artifact_id") for item in outputs):
            break
        time.sleep(10)

    for output in outputs:
        if output.get("status") not in TERMINAL_STATUSES:
            output["status"] = "not_found" if not output.get("artifact_id") else output["status"]
        if output.get("status") == "completed":
            download_artifact(job, output)
    refresh_job(job)


def notebooks_payload() -> dict[str, Any]:
    result = run_notebooklm(["list", "--json"])
    if not result["ok"]:
        return {"ok": False, "error": result["stderr"] or result["stdout"], "notebooks": []}
    notebooks = result["stdout"].get("notebooks", []) if isinstance(result["stdout"], dict) else []
    normalized: dict[str, int] = {}
    for nb in notebooks:
        title = (nb.get("title") or "").strip()
        key = title.lower()
        if key:
            normalized[key] = normalized.get(key, 0) + 1
    enriched = []
    for nb in notebooks:
        title = (nb.get("title") or "").strip()
        enriched.append(
            {
                "id": nb.get("id"),
                "index": nb.get("index"),
                "title": title,
                "display_title": title or "Untitled notebook",
                "created_at": nb.get("created_at"),
                "is_owner": nb.get("is_owner"),
                "warnings": {
                    "empty_title": not bool(title),
                    "possible_duplicate": bool(title) and normalized.get(title.lower(), 0) > 1,
                },
            }
        )
    return {"ok": True, "count": len(enriched), "notebooks": enriched}


def notebook_overview(notebook_id: str) -> dict[str, Any]:
    def produce():
        sources = run_notebooklm(["source", "list", "-n", notebook_id, "--json"], timeout=60)
        artifacts = run_notebooklm(["artifact", "list", "-n", notebook_id, "--type", "all", "--json"], timeout=60)
        source_items = []
        artifact_items = []
        if sources["ok"] and isinstance(sources["stdout"], dict):
            source_items = sources["stdout"].get("sources", [])
        if artifacts["ok"] and isinstance(artifacts["stdout"], dict):
            artifact_items = artifacts["stdout"].get("artifacts", [])
        last_activity = None
        for item in [*source_items, *artifact_items]:
            created = item.get("created_at")
            if created and (last_activity is None or created > last_activity):
                last_activity = created
        failed_count = sum(1 for item in artifact_items if str(item.get("status")).lower() == "failed")
        completed_kinds = sorted(
            {
                artifact_kind(str(item.get("type_id") or "").lower())
                for item in artifact_items
                if str(item.get("status")).lower() == "completed"
            }
        )
        status = "Ready"
        if not source_items:
            status = "Missing sources"
        elif failed_count:
            status = "Has failed artifact"
        elif any(str(item.get("status")).lower() in {"pending", "in_progress"} for item in artifact_items):
            status = "Generating"
        return {
            "ok": sources["ok"] or artifacts["ok"],
            "source_count": len(source_items),
            "artifact_count": len(artifact_items),
            "failed_count": failed_count,
            "completed_kinds": completed_kinds,
            "last_activity": last_activity,
            "status": status,
            "sources": source_items,
            "artifacts": artifact_items,
            "source_error": None if sources["ok"] else sources["stderr"] or sources["stdout"],
            "artifact_error": None if artifacts["ok"] else artifacts["stderr"] or artifacts["stdout"],
        }

    return cached(f"overview:{notebook_id}", 20, produce)


def create_job(payload: dict[str, Any]) -> dict[str, Any]:
    created_at = now_iso()
    artifacts = payload.get("artifacts") or []
    commands = payload.get("commands") or []
    job = {
        "id": f"job-{int(time.time() * 1000)}",
        "notebook_id": payload.get("notebook_id"),
        "label": payload.get("label") or "NotebookLM task",
        "notebook_title": payload.get("notebook_title") or "Untitled notebook",
        "kind": payload.get("kind") or "recipe",
        "purpose": payload.get("purpose"),
        "artifacts": artifacts,
        "commands": commands,
        "outputs": [],
        "status": "queued",
        "created_at": created_at,
        "updated_at": created_at,
        "steps": [
            {"name": "Queued for NotebookLM", "status": "active"},
        ],
        "progress": 3,
        "preview": False,
    }
    with JOB_LOCK:
        JOBS.insert(0, job)
    worker = threading.Thread(target=run_real_job, args=(job,), daemon=True)
    worker.start()
    return job


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/notebooks":
            self.send_json(cached("notebooks", 15, notebooks_payload))
            return
        if path.startswith("/api/notebook/") and path.endswith("/overview"):
            notebook_id = path.split("/")[3]
            self.send_json(notebook_overview(notebook_id))
            return
        if path == "/api/jobs":
            load_persisted_jobs()
            with JOB_LOCK:
                jobs = list(JOBS)
            self.send_json({"ok": True, "jobs": jobs})
            return
        self.serve_static(path)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in {"/api/jobs", "/api/handoff"}:
            self.send_json({"ok": False, "error": "Not found"}, 404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self.send_json({"ok": False, "error": "Invalid JSON"}, 400)
            return
        if parsed.path == "/api/handoff":
            self.send_json(prepare_agent_prompt(str(payload.get("job_id") or "")))
            return
        self.send_json({"ok": True, "job": create_job(payload)})

    def do_DELETE(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/api/jobs":
            self.send_json({"ok": False, "error": "Not found"}, 404)
            return
        with JOB_LOCK:
            JOBS[:] = [
                job
                for job in JOBS
                if job.get("status") in {"queued", "submitting", "generating"}
            ]
            jobs = list(JOBS)
        self.send_json({"ok": True, "jobs": jobs})

    def serve_static(self, path: str) -> None:
        if path in {"", "/"}:
            path = "/index.html"
        target = (DASHBOARD_ROOT / path.lstrip("/")).resolve()
        if not str(target).startswith(str(DASHBOARD_ROOT.resolve())) or not target.exists() or target.is_dir():
            target = DASHBOARD_ROOT / "index.html"
        body = target.read_bytes()
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        if target.suffix in {".html", ".css", ".js"}:
            self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    global OUTPUT_ROOT, NOTEBOOKLM_PROFILE
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--profile", default=os.environ.get("NOTEBOOKLM_PROFILE", "default"))
    parser.add_argument(
        "--out-dir",
        default=str(Path.cwd() / "notebooklm_outputs" / "dashboard"),
        help="Directory for downloaded dashboard artifacts and handoff files.",
    )
    args = parser.parse_args()
    NOTEBOOKLM_PROFILE = args.profile
    OUTPUT_ROOT = Path(args.out_dir).expanduser().resolve()
    if not (DASHBOARD_ROOT / "index.html").exists():
        raise SystemExit(f"Dashboard assets not found: {DASHBOARD_ROOT}")
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    server = None
    selected_port = args.port
    for candidate_port in [args.port] if args.port == 0 else range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer((args.host, candidate_port), Handler)
            selected_port = server.server_address[1]
            break
        except OSError as exc:
            if exc.errno != errno.EADDRINUSE:
                raise
    if server is None:
        raise SystemExit(f"No available local port found from {args.port} to {args.port + 19}")
    print(f"NotebookLM Studio Dashboard running at http://{args.host}:{selected_port}/")
    print(f"Profile: {NOTEBOOKLM_PROFILE}")
    print(f"Output directory: {OUTPUT_ROOT}")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
