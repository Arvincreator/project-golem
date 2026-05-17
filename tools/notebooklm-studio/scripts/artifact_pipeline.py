#!/usr/bin/env python3
"""Submit NotebookLM artifact jobs quickly, poll them as a group, and download completed outputs."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


ARTIFACTS = {
    "audio", "video", "cinematic-video", "report", "mind-map", "quiz", "flashcards",
    "slide-deck", "infographic", "data-table",
}
TYPE_IDS = {
    "audio": "audio",
    "video": "video",
    "cinematic-video": "video",
    "report": "report",
    "mind-map": "mind_map",
    "quiz": "quiz",
    "flashcards": "flashcard",
    "slide-deck": "slide_deck",
    "infographic": "infographic",
    "data-table": "data_table",
}
DOWNLOAD_TYPES = {
    "cinematic-video": "video",
}
WAITABLE = ARTIFACTS - {"mind-map"}
DEFAULT_EXT = {
    "audio": ".mp4",
    "video": ".mp4",
    "cinematic-video": ".mp4",
    "report": ".md",
    "mind-map": ".json",
    "quiz": ".json",
    "flashcards": ".json",
    "slide-deck": ".pdf",
    "infographic": ".png",
    "data-table": ".csv",
}
UUID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")


@dataclass
class Job:
    artifact: str
    index: int
    status: str = "planned"
    artifact_id: str | None = None
    title: str | None = None
    submit_command: list[str] = field(default_factory=list)
    download_commands: list[list[str]] = field(default_factory=list)
    outputs: list[str] = field(default_factory=list)
    error: str | None = None
    attempts: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "artifact": self.artifact,
            "index": self.index,
            "status": self.status,
            "artifact_id": self.artifact_id,
            "title": self.title,
            "submit_command": command_text(self.submit_command) if self.submit_command else None,
            "download_commands": [command_text(cmd) for cmd in self.download_commands],
            "outputs": self.outputs,
            "error": self.error,
            "attempts": self.attempts,
        }


def command_text(cmd: list[str]) -> str:
    return shlex.join(cmd)


def base_cmd(profile: str | None) -> list[str]:
    cmd = ["notebooklm"]
    if profile:
        cmd.extend(["-p", profile])
    return cmd


def notebook_arg(args: argparse.Namespace) -> list[str]:
    if args.notebook_id:
        return ["-n", args.notebook_id]
    return []


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned[:80] or "notebooklm"


def run_command(cmd: list[str], timeout: int | None = None) -> dict[str, Any]:
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, check=False)
    return {
        "command": command_text(cmd),
        "returncode": proc.returncode,
        "ok": proc.returncode == 0,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def json_from_text(text: str) -> Any | None:
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for opener, closer in (("{", "}"), ("[", "]")):
        start = text.find(opener)
        end = text.rfind(closer)
        if start >= 0 and end > start:
            try:
                return json.loads(text[start : end + 1])
            except json.JSONDecodeError:
                continue
    return None


def extract_uuid(value: Any, preferred_keys: tuple[str, ...] = ("artifact", "task", "generation")) -> str | None:
    candidates: list[tuple[int, str]] = []

    def walk(item: Any, key_hint: str = "") -> None:
        if isinstance(item, dict):
            for key, child in item.items():
                hint = f"{key_hint}.{key}".lower()
                walk(child, hint)
        elif isinstance(item, list):
            for child in item:
                walk(child, key_hint)
        elif isinstance(item, str):
            for match in UUID_RE.findall(item):
                score = 0
                if any(token in key_hint for token in preferred_keys):
                    score += 10
                if key_hint.endswith("id") or key_hint.endswith("_id"):
                    score += 3
                candidates.append((score, match))

    walk(value)
    if not candidates:
        return None
    candidates.sort(reverse=True)
    return candidates[0][1]


def artifact_prompt(artifact: str, prompt: str | None) -> str | None:
    if prompt:
        return prompt
    defaults = {
        "audio": "Create an engaging overview grounded in the uploaded sources.",
        "video": "Create an engaging visual overview grounded in the uploaded sources.",
        "cinematic-video": "Create an immersive cinematic overview grounded in the uploaded sources.",
        "report": "Create a source-grounded briefing document with key findings, risks, and next actions.",
        "mind-map": "Create a clear mind map of the main ideas and relationships.",
        "quiz": "Create a quiz that tests understanding of the important ideas.",
        "flashcards": "Create flashcards for the important concepts and definitions.",
        "slide-deck": "Create a polished presentation for a general professional audience.",
        "infographic": "Create a clear visual summary of the most important ideas.",
        "data-table": "Create a useful structured data table from the notebook sources.",
    }
    return defaults.get(artifact)


def build_generate_command(args: argparse.Namespace, artifact: str) -> list[str]:
    cmd = base_cmd(args.profile) + ["generate", artifact] + notebook_arg(args)
    prompt = artifact_prompt(artifact, args.prompt)
    if artifact == "mind-map":
        if prompt:
            cmd.extend(["--instructions", prompt])
    elif prompt:
        cmd.append(prompt)

    if args.language and artifact not in {"quiz", "flashcards"}:
        cmd.extend(["--language", args.language])
    if artifact == "audio":
        cmd.extend(["--format", args.audio_format, "--length", args.audio_length])
    elif artifact in {"video", "cinematic-video"}:
        cmd.extend(["--format", args.video_format, "--style", args.video_style])
    elif artifact == "report":
        cmd.extend(["--format", args.report_format])
    elif artifact in {"quiz", "flashcards"}:
        cmd.extend(["--difficulty", args.difficulty, "--quantity", args.quantity])
    elif artifact == "slide-deck":
        cmd.extend(["--format", args.slide_format, "--length", args.slide_length])
    elif artifact == "infographic":
        cmd.extend(["--orientation", args.orientation, "--detail", args.detail, "--style", args.infographic_style])

    if artifact in WAITABLE:
        cmd.append("--no-wait")
    if artifact in WAITABLE and args.retry:
        cmd.extend(["--retry", str(args.retry)])
    cmd.append("--json")
    return cmd


def output_paths(args: argparse.Namespace, job: Job) -> list[Path]:
    root = Path(args.out_dir)
    title = slug(args.notebook_title or args.notebook_id or "notebook")
    base = root / f"{title}-{job.index:02d}-{job.artifact}"
    if job.artifact == "slide-deck" and args.download_slide_format == "both":
        return [base.with_suffix(".pdf"), base.with_suffix(".pptx")]
    ext = DEFAULT_EXT[job.artifact]
    if job.artifact == "slide-deck" and args.download_slide_format == "pptx":
        ext = ".pptx"
    if job.artifact in {"quiz", "flashcards"}:
        ext = {"json": ".json", "markdown": ".md", "html": ".html"}[args.study_download_format]
    return [base.with_suffix(ext)]


def build_download_commands(args: argparse.Namespace, job: Job) -> list[list[str]]:
    commands = []
    download_type = DOWNLOAD_TYPES.get(job.artifact, job.artifact)
    for path in output_paths(args, job):
        cmd = base_cmd(args.profile) + ["download", download_type] + notebook_arg(args)
        if job.artifact_id:
            cmd.extend(["--artifact", job.artifact_id])
        else:
            cmd.append("--latest")
        cmd.extend(["--force", "--json"])
        if job.artifact == "slide-deck":
            fmt = "pptx" if path.suffix == ".pptx" else "pdf"
            cmd.extend(["--format", fmt])
        if job.artifact in {"quiz", "flashcards"}:
            cmd.extend(["--format", args.study_download_format])
        cmd.append(str(path))
        commands.append(cmd)
    return commands


def create_or_use_notebook(args: argparse.Namespace) -> tuple[str | None, list[dict[str, Any]]]:
    results = []
    if args.notebook_id:
        cmd = base_cmd(args.profile) + ["use", args.notebook_id, "--json"]
        result = run_command(cmd)
        results.append(result)
        return args.notebook_id, results
    cmd = base_cmd(args.profile) + ["create", args.notebook_title, "--use", "--json"]
    result = run_command(cmd)
    results.append(result)
    payload = json_from_text(result["stdout"])
    return extract_uuid(payload) or extract_uuid(result["stdout"]) or None, results


def add_sources(args: argparse.Namespace) -> list[dict[str, Any]]:
    results = []
    for source in args.source:
        cmd = base_cmd(args.profile) + ["source", "add"] + notebook_arg(args) + [source, "--json"]
        add_result = run_command(cmd)
        results.append(add_result)
        payload = json_from_text(add_result["stdout"])
        source_id = extract_uuid(payload) or extract_uuid(add_result["stdout"])
        if args.wait_sources and add_result["ok"] and source_id:
            wait_cmd = base_cmd(args.profile) + ["source", "wait"] + notebook_arg(args) + [source_id, "--timeout", str(args.source_timeout), "--json"]
            results.append(run_command(wait_cmd))
        if args.source_delay:
            time.sleep(args.source_delay)
    return results


def artifact_list(args: argparse.Namespace) -> list[dict[str, Any]]:
    cmd = base_cmd(args.profile) + ["artifact", "list"] + notebook_arg(args) + ["--type", "all", "--json"]
    result = run_command(cmd, timeout=90)
    if not result["ok"]:
        return []
    payload = json_from_text(result["stdout"])
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        items = payload.get("artifacts") or payload.get("items") or payload.get("data") or []
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
    return []


def normalize_status(value: Any) -> str:
    text = str(value or "").lower().replace(" ", "_")
    if text in {"3", "completed", "complete", "done", "ready"}:
        return "completed"
    if text in {"4", "failed", "error", "generation_failed"}:
        return "failed"
    if text in {"1", "2", "queued", "pending", "running", "in_progress", "processing"}:
        return "in_progress"
    return text or "unknown"


def match_jobs_from_artifacts(jobs: list[Job], artifacts: list[dict[str, Any]]) -> None:
    for job in jobs:
        target_type = TYPE_IDS[job.artifact]
        candidates = []
        for artifact in artifacts:
            artifact_id = str(artifact.get("id") or artifact.get("artifact_id") or "")
            type_id = str(artifact.get("type_id") or artifact.get("type") or "").lower().replace("-", "_").replace(" ", "_")
            if job.artifact_id and artifact_id == job.artifact_id:
                candidates.append(artifact)
            elif not job.artifact_id and type_id == target_type:
                candidates.append(artifact)
        if not candidates:
            continue
        chosen = candidates[0]
        job.artifact_id = str(chosen.get("id") or chosen.get("artifact_id") or job.artifact_id or "")
        job.title = str(chosen.get("title") or job.title or "")
        job.status = normalize_status(chosen.get("status_id") or chosen.get("status"))


def submit_jobs(args: argparse.Namespace) -> list[Job]:
    jobs = [Job(artifact=artifact, index=index) for index, artifact in enumerate(args.artifact, start=1)]
    for job in jobs:
        job.submit_command = build_generate_command(args, job.artifact)
        if args.submit_delay:
            time.sleep(args.submit_delay)
        result = run_command(job.submit_command, timeout=None)
        job.attempts += 1
        if result["ok"]:
            payload = json_from_text(result["stdout"])
            job.artifact_id = extract_uuid(payload) or extract_uuid(result["stdout"])
            job.status = "submitted"
        else:
            job.status = "submit_failed"
            job.error = result["stderr"] or result["stdout"]
    return jobs


def download_job(args: argparse.Namespace, job: Job) -> None:
    Path(args.out_dir).mkdir(parents=True, exist_ok=True)
    job.download_commands = build_download_commands(args, job)
    for cmd, expected_path in zip(job.download_commands, output_paths(args, job)):
        result = run_command(cmd, timeout=None)
        if not result["ok"]:
            job.status = "download_failed"
            job.error = result["stderr"] or result["stdout"]
            return
        if expected_path.exists():
            job.outputs.append(str(expected_path.resolve()))
            if job.artifact == "mind-map" and args.convert_mind_map_html and expected_path.suffix == ".json":
                html_path = expected_path.with_suffix(".html")
                convert_cmd = [sys.executable, str(Path(__file__).with_name("mindmap_html.py")), str(expected_path), "-o", str(html_path), "--json"]
                convert_result = run_command(convert_cmd)
                if convert_result["ok"] and html_path.exists():
                    job.outputs.append(str(html_path.resolve()))
    if job.status != "download_failed":
        job.status = "downloaded"


def write_status(path: Path | None, payload: dict[str, Any]) -> None:
    if not path:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True) + "\n", encoding="utf-8")


def plan_payload(args: argparse.Namespace) -> dict[str, Any]:
    jobs = [Job(artifact=artifact, index=index, submit_command=build_generate_command(args, artifact)) for index, artifact in enumerate(args.artifact, start=1)]
    for job in jobs:
        job.download_commands = build_download_commands(args, job) if args.download else []
    return {
        "mode": "plan",
        "strategy": "submit requested artifacts with --no-wait where supported, then poll artifact status table and download each completed output independently",
        "notebook": {"title": args.notebook_title, "id": args.notebook_id},
        "sources": args.source,
        "jobs": [job.to_dict() for job in jobs],
        "mind_map_html": bool(args.convert_mind_map_html),
    }


def run_pipeline(args: argparse.Namespace) -> dict[str, Any]:
    if not shutil.which("notebooklm"):
        return {"ok": False, "error": "notebooklm CLI not found"}
    notebook_id, notebook_results = create_or_use_notebook(args)
    if notebook_id and not args.notebook_id:
        args.notebook_id = notebook_id
    source_results = add_sources(args)
    jobs = submit_jobs(args)

    deadline = time.time() + args.wait_timeout
    while time.time() < deadline:
        artifacts = artifact_list(args)
        match_jobs_from_artifacts(jobs, artifacts)
        for job in jobs:
            if args.download and job.status == "completed" and not job.outputs:
                download_job(args, job)
        if all(job.status in {"downloaded", "failed", "submit_failed", "download_failed"} for job in jobs):
            break
        write_status(Path(args.status_file) if args.status_file else None, {
            "ok": True,
            "notebook_id": args.notebook_id,
            "jobs": [job.to_dict() for job in jobs],
        })
        time.sleep(args.poll_interval)

    for job in jobs:
        if job.status not in {"downloaded", "failed", "submit_failed", "download_failed"}:
            job.status = "timeout"

    payload = {
        "ok": all(job.status == "downloaded" or (not args.download and job.status == "completed") for job in jobs),
        "notebook_id": args.notebook_id,
        "notebook_results": notebook_results,
        "source_results": source_results,
        "jobs": [job.to_dict() for job in jobs],
    }
    write_status(Path(args.status_file) if args.status_file else None, payload)
    return payload


def add_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--profile", help="notebooklm profile name")
    notebook = parser.add_mutually_exclusive_group(required=True)
    notebook.add_argument("--notebook-title", help="create a new notebook with this title")
    notebook.add_argument("--notebook-id", help="reuse an existing notebook id")
    parser.add_argument("--source", action="append", default=[], help="source URL, file path, text, or '-'")
    parser.add_argument("--artifact", action="append", choices=sorted(ARTIFACTS), required=True)
    parser.add_argument("--prompt", help="shared steering prompt")
    parser.add_argument("--language", help="NotebookLM output language")
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--out-dir", default="notebooklm_outputs")
    parser.add_argument("--status-file", help="write live job table JSON here")
    parser.add_argument("--wait-timeout", type=int, default=1800)
    parser.add_argument("--poll-interval", type=int, default=15)
    parser.add_argument("--retry", type=int, default=2)
    parser.add_argument("--submit-delay", type=float, default=1.0)
    parser.add_argument("--source-delay", type=float, default=0.0)
    parser.add_argument("--source-timeout", type=int, default=300)
    parser.add_argument("--wait-sources", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--convert-mind-map-html", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--audio-format", default="deep-dive", choices=["deep-dive", "brief", "critique", "debate"])
    parser.add_argument("--audio-length", default="default", choices=["short", "default", "long"])
    parser.add_argument("--video-format", default="explainer", choices=["explainer", "brief", "cinematic"])
    parser.add_argument("--video-style", default="auto", choices=["auto", "classic", "whiteboard", "kawaii", "anime", "watercolor", "retro-print", "heritage", "paper-craft"])
    parser.add_argument("--report-format", default="briefing-doc", choices=["briefing-doc", "study-guide", "blog-post", "custom"])
    parser.add_argument("--difficulty", default="medium", choices=["easy", "medium", "hard"])
    parser.add_argument("--quantity", default="standard", choices=["fewer", "standard", "more"])
    parser.add_argument("--slide-format", default="presenter", choices=["detailed", "presenter"])
    parser.add_argument("--slide-length", default="default", choices=["default", "short"])
    parser.add_argument("--download-slide-format", default="pdf", choices=["pdf", "pptx", "both"])
    parser.add_argument("--orientation", default="landscape", choices=["landscape", "portrait", "square"])
    parser.add_argument("--detail", default="standard", choices=["concise", "standard", "detailed"])
    parser.add_argument("--infographic-style", default="auto", choices=["auto", "sketch-note", "professional", "bento-grid", "editorial", "instructional", "bricks", "clay", "anime", "kawaii", "scientific"])
    parser.add_argument("--study-download-format", default="json", choices=["json", "markdown", "html"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "run"):
        child = sub.add_parser(name)
        add_args(child)
    args = parser.parse_args()

    payload = plan_payload(args) if args.command == "plan" else run_pipeline(args)
    print(json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True))
    return 0 if payload.get("ok", True) else 1


if __name__ == "__main__":
    raise SystemExit(main())
