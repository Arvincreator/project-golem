#!/usr/bin/env python3
"""Automate first-time setup for the NotebookLM Studio skill."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
QUICKSTART = ROOT / "references" / "quickstart-guide.md"
DASHBOARD_SERVER = ROOT / "scripts" / "dashboard_server.py"


def run_command(args: list[str], timeout: int | None = None) -> dict[str, Any]:
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout, check=False)
    except FileNotFoundError:
        return {"ok": False, "returncode": 127, "stdout": "", "stderr": "command not found", "command": args}
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": None,
            "stdout": exc.stdout or "",
            "stderr": f"timed out after {timeout}s",
            "command": args,
        }
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
        "command": args,
    }


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def auth_material(profile: str) -> dict[str, Any]:
    home = Path(os.environ.get("NOTEBOOKLM_HOME", Path.home() / ".notebooklm")).expanduser()
    paths = [home / "profiles" / profile / "storage_state.json", home / "storage_state.json"]
    existing = [str(path) for path in paths if path.exists()]
    return {
        "home": str(home),
        "profile": profile,
        "storage_files_found": existing,
        "has_inline_auth_json": bool(os.environ.get("NOTEBOOKLM_AUTH_JSON")),
        "has_any_auth_material": bool(existing) or bool(os.environ.get("NOTEBOOKLM_AUTH_JSON")),
    }


def status(profile: str, auth_test: bool = False) -> dict[str, Any]:
    cli = shutil.which("notebooklm")
    data: dict[str, Any] = {
        "notebooklm_cli": cli,
        "notebooklm_py_version": package_version("notebooklm-py"),
        "playwright_version": package_version("playwright"),
        "auth": auth_material(profile),
        "checks": {},
    }
    if cli:
        data["checks"]["version"] = run_command(["notebooklm", "--version"], timeout=20)
        if auth_test:
            data["checks"]["auth_test"] = run_command(
                ["notebooklm", "-p", profile, "auth", "check", "--test", "--json"],
                timeout=90,
            )
    ready = bool(cli) and data["auth"]["has_any_auth_material"]
    if auth_test:
        ready = ready and bool(data["checks"].get("auth_test", {}).get("ok"))
    data["ready_for_notebooklm"] = ready
    data["needs"] = []
    if not cli:
        data["needs"].append("install notebooklm-py with browser support")
    if not data["auth"]["has_any_auth_material"]:
        data["needs"].append("manual Google login")
    if auth_test and not data["checks"].get("auth_test", {}).get("ok"):
        data["needs"].append("working NotebookLM auth test")
    return data


def install_dependencies() -> list[dict[str, Any]]:
    steps = []
    steps.append(run_command([sys.executable, "-m", "pip", "install", "notebooklm-py[browser]"], timeout=None))
    if steps[-1]["ok"]:
        steps.append(run_command([sys.executable, "-m", "playwright", "install", "chromium"], timeout=None))
    return steps


def login(profile: str, browser: str) -> dict[str, Any]:
    cmd = ["notebooklm", "-p", profile, "login"]
    if browser:
        cmd.extend(["--browser", browser])
    return run_command(cmd, timeout=None)


def guide_text(state: dict[str, Any]) -> str:
    readiness = "ready" if state.get("ready_for_notebooklm") else "not ready yet"
    needs = state.get("needs") or []
    quickstart = QUICKSTART.read_text(encoding="utf-8") if QUICKSTART.exists() else ""
    preface = f"""# NotebookLM Studio Setup Result\n\nCurrent status: **{readiness}**.\n\nDetected CLI: `{state.get('notebooklm_cli') or 'missing'}`.\nDetected notebooklm-py: `{state.get('notebooklm_py_version') or 'not installed'}`.\nDetected Playwright: `{state.get('playwright_version') or 'not installed'}`.\nAuth material: `{'yes' if state.get('auth', {}).get('has_any_auth_material') else 'no'}`.\n\n"""
    if needs:
        preface += "Next required steps:\n" + "".join(f"- {need}\n" for need in needs) + "\n"
    else:
        preface += "NotebookLM automation is ready. You can now ask Codex to create notebooks and artifacts.\n\n"
    if DASHBOARD_SERVER.exists():
        preface += (
            "Local dashboard command:\n"
            f"`python {DASHBOARD_SERVER} --host 127.0.0.1 --port 8765 --profile "
            f"{state.get('auth', {}).get('profile') or 'default'} --out-dir ./notebooklm_outputs/dashboard`\n\n"
        )
    return preface + quickstart


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--profile", default=os.environ.get("NOTEBOOKLM_PROFILE", "default"))
    parser.add_argument("--install", action="store_true", help="install notebooklm-py[browser] and Playwright Chromium")
    parser.add_argument("--login", action="store_true", help="start manual Google login")
    parser.add_argument("--browser", default="chromium", choices=["chromium", "msedge"])
    parser.add_argument("--auth-test", action="store_true", help="run NotebookLM auth check after setup")
    parser.add_argument("--json", action="store_true", help="print JSON state")
    parser.add_argument("--print-guide", action="store_true", help="print a user guide after setup")
    parser.add_argument("--output-guide", help="write the generated guide to a Markdown file")
    args = parser.parse_args()

    actions: list[dict[str, Any]] = []
    before = status(args.profile, auth_test=False)

    if args.install and not before.get("notebooklm_cli"):
        actions.extend(install_dependencies())

    mid = status(args.profile, auth_test=False)
    if args.login:
        if not mid.get("notebooklm_cli"):
            actions.append({"ok": False, "returncode": 127, "stderr": "notebooklm CLI is missing; install first", "command": ["notebooklm", "login"]})
        else:
            actions.append(login(args.profile, args.browser))

    final = status(args.profile, auth_test=args.auth_test)
    final["actions"] = actions

    if args.output_guide:
        Path(args.output_guide).write_text(guide_text(final), encoding="utf-8")
        final["guide_path"] = str(Path(args.output_guide).resolve())

    if args.json:
        print(json.dumps(final, indent=2, sort_keys=True))

    if args.print_guide:
        if args.json:
            print("\n--- GUIDE ---\n")
        print(guide_text(final))

    if not args.json and not args.print_guide:
        print(f"NotebookLM Studio is {'ready' if final['ready_for_notebooklm'] else 'not ready yet'}")
        for need in final["needs"]:
            print(f"- {need}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
