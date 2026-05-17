#!/usr/bin/env python3
"""Plan and optionally run a NotebookLM artifact workflow."""

from __future__ import annotations

import argparse
import json
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


ARTIFACTS = {
    "audio", "video", "cinematic-video", "report", "mind-map", "quiz", "flashcards",
    "slide-deck", "infographic", "data-table",
}
LANGUAGE_AWARE = {
    "audio", "video", "cinematic-video", "report", "mind-map", "slide-deck", "infographic", "data-table",
}
DOWNLOAD_EXTENSIONS = {
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


def slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip()).strip("-")
    return cleaned[:80] or "notebooklm"


def base_cmd(profile: str | None) -> list[str]:
    cmd = ["notebooklm"]
    if profile:
        cmd.extend(["-p", profile])
    return cmd


def command_text(cmd: list[str]) -> str:
    return shlex.join(cmd)


def artifact_prompt(artifact: str, prompt: str | None) -> str | None:
    if prompt:
        return prompt
    defaults = {
        "report": "Create a source-grounded briefing document with key findings, risks, and next actions.",
        "data-table": "Create a useful structured data table from the notebook sources.",
        "slide-deck": "Create a polished presentation for a general professional audience.",
        "infographic": "Create a clear visual summary of the most important ideas.",
        "audio": "Create an engaging overview grounded in the uploaded sources.",
        "video": "Create an engaging visual overview grounded in the uploaded sources.",
        "cinematic-video": "Create an immersive cinematic overview grounded in the uploaded sources.",
        "quiz": "Create a quiz that tests understanding of the important ideas.",
        "flashcards": "Create flashcards for the important concepts and definitions.",
    }
    return defaults.get(artifact)


def build_generate_command(args: argparse.Namespace, artifact: str) -> list[str]:
    cmd = base_cmd(args.profile) + ["generate", artifact]
    prompt = artifact_prompt(artifact, args.prompt)
    if prompt and artifact != "mind-map":
        cmd.append(prompt)
    if artifact == "mind-map" and prompt:
        cmd.extend(["--instructions", prompt])
    if artifact in LANGUAGE_AWARE and args.language:
        cmd.extend(["--language", args.language])
    if artifact == "audio":
        cmd.extend(["--format", args.audio_format, "--length", args.audio_length])
    elif artifact == "video":
        cmd.extend(["--format", args.video_format, "--style", args.video_style])
    elif artifact == "report":
        cmd.extend(["--format", args.report_format])
    elif artifact == "quiz":
        cmd.extend(["--difficulty", args.difficulty, "--quantity", args.quantity])
    elif artifact == "flashcards":
        cmd.extend(["--difficulty", args.difficulty, "--quantity", args.quantity])
    elif artifact == "slide-deck":
        cmd.extend(["--format", args.slide_format, "--length", args.slide_length])
    elif artifact == "infographic":
        cmd.extend(["--orientation", args.orientation, "--detail", args.detail, "--style", args.infographic_style])

    if artifact != "mind-map":
        if args.wait:
            cmd.append("--wait")
        if args.retry:
            cmd.extend(["--retry", str(args.retry)])
    cmd.append("--json")
    return cmd


def build_download_command(args: argparse.Namespace, artifact: str, index: int) -> list[str]:
    out_dir = Path(args.out_dir)
    ext = DOWNLOAD_EXTENSIONS[artifact]
    download_type = artifact
    if artifact == "cinematic-video":
        download_type = "video"
    if artifact == "slide-deck" and args.download_slide_format == "pptx":
        ext = ".pptx"
    if artifact == "flashcards" and args.study_download_format == "markdown":
        ext = ".md"
    if artifact == "quiz" and args.study_download_format == "markdown":
        ext = ".md"
    if artifact in {"flashcards", "quiz"} and args.study_download_format == "html":
        ext = ".html"
    title = slug(args.notebook_title or args.notebook_id or "notebook")
    path = out_dir / f"{title}-{index:02d}-{artifact}{ext}"
    cmd = base_cmd(args.profile) + ["download", download_type, str(path), "--force", "--json"]
    if artifact not in {"quiz", "flashcards"}:
        cmd.insert(-2, "--latest")
    if artifact == "slide-deck":
        cmd.extend(["--format", args.download_slide_format])
    if artifact in {"quiz", "flashcards"}:
        cmd.extend(["--format", args.study_download_format])
    return cmd


def build_plan(args: argparse.Namespace) -> list[dict[str, Any]]:
    steps: list[dict[str, Any]] = []
    if args.notebook_id:
        steps.append({"kind": "use-notebook", "command": base_cmd(args.profile) + ["use", args.notebook_id, "--json"]})
    elif args.notebook_title:
        steps.append(
            {
                "kind": "create-notebook",
                "command": base_cmd(args.profile) + ["create", args.notebook_title, "--use", "--json"],
            }
        )

    for source in args.source:
        steps.append(
            {
                "kind": "add-source",
                "source": source,
                "command": base_cmd(args.profile) + ["source", "add", source, "--json"],
            }
        )

    for index, artifact in enumerate(args.artifact, start=1):
        steps.append({"kind": f"generate-{artifact}", "artifact": artifact, "command": build_generate_command(args, artifact)})
        if args.download:
            steps.append(
                {
                    "kind": f"download-{artifact}",
                    "artifact": artifact,
                    "command": build_download_command(args, artifact, index),
                }
            )
    return steps


def run_step(step: dict[str, Any]) -> dict[str, Any]:
    cmd = step["command"]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return {
        "kind": step["kind"],
        "command": command_text(cmd),
        "returncode": proc.returncode,
        "ok": proc.returncode == 0,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--profile", help="notebooklm profile name")
    notebook = parser.add_mutually_exclusive_group()
    notebook.add_argument("--notebook-title", help="create a new notebook with this title")
    notebook.add_argument("--notebook-id", help="reuse an existing notebook id")
    parser.add_argument("--source", action="append", default=[], help="source URL, file path, text, or '-'")
    parser.add_argument("--artifact", action="append", choices=sorted(ARTIFACTS), default=[])
    parser.add_argument("--prompt", help="shared steering prompt for generated artifacts")
    parser.add_argument("--language", help="NotebookLM output language code/name")
    parser.add_argument("--download", action="store_true", help="download each generated artifact")
    parser.add_argument("--out-dir", default="notebooklm_outputs")
    parser.add_argument("--wait", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--timeout", type=int, default=900, help=argparse.SUPPRESS)
    parser.add_argument("--retry", type=int, default=2)
    parser.add_argument("--source-timeout", type=int, default=300, help=argparse.SUPPRESS)
    parser.add_argument("--audio-format", default="deep-dive", choices=["deep-dive", "brief", "critique", "debate"])
    parser.add_argument("--audio-length", default="default", choices=["short", "default", "long"])
    parser.add_argument("--video-format", default="explainer", choices=["explainer", "brief", "cinematic"])
    parser.add_argument(
        "--video-style",
        default="auto",
        choices=["auto", "classic", "whiteboard", "kawaii", "anime", "watercolor", "retro-print", "heritage", "paper-craft"],
    )
    parser.add_argument("--report-format", default="briefing-doc", choices=["briefing-doc", "study-guide", "blog-post", "custom"])
    parser.add_argument("--difficulty", default="medium", choices=["easy", "medium", "hard"])
    parser.add_argument("--quantity", default="standard", choices=["fewer", "standard", "more"])
    parser.add_argument("--slide-format", default="presenter", choices=["detailed", "presenter"])
    parser.add_argument("--slide-length", default="default", choices=["default", "short"])
    parser.add_argument("--download-slide-format", default="pdf", choices=["pdf", "pptx"])
    parser.add_argument("--orientation", default="landscape", choices=["landscape", "portrait", "square"])
    parser.add_argument("--detail", default="standard", choices=["concise", "standard", "detailed"])
    parser.add_argument(
        "--infographic-style",
        default="auto",
        choices=["auto", "sketch-note", "professional", "bento-grid", "editorial", "instructional", "bricks", "clay", "anime", "kawaii", "scientific"],
    )
    parser.add_argument("--study-download-format", default="json", choices=["json", "markdown", "html"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("plan", "run"):
        child = sub.add_parser(name)
        add_common_args(child)
    args = parser.parse_args()

    if not args.notebook_title and not args.notebook_id:
        parser.error("provide --notebook-title for a new notebook or --notebook-id to reuse one")
    if not args.source and not args.artifact:
        parser.error("provide at least one --source or --artifact")

    steps = build_plan(args)
    plan = {
        "mode": args.command,
        "step_count": len(steps),
        "steps": [{**step, "command_text": command_text(step["command"])} for step in steps],
    }

    if args.command == "plan":
        print(json.dumps(plan, indent=2, sort_keys=True))
        return 0

    if not shutil.which("notebooklm"):
        print(json.dumps({"ok": False, "error": "notebooklm CLI not found", "plan": plan}, indent=2), file=sys.stderr)
        return 127

    if args.download:
        Path(args.out_dir).mkdir(parents=True, exist_ok=True)

    results = []
    for step in steps:
        result = run_step(step)
        results.append(result)
        if not result["ok"]:
            print(json.dumps({"ok": False, "failed_step": result, "results": results}, indent=2, sort_keys=True))
            return result["returncode"] or 1

    print(json.dumps({"ok": True, "results": results}, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
