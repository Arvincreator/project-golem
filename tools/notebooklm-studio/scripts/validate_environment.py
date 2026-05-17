#!/usr/bin/env python3
"""Check whether NotebookLM automation is ready for this machine."""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


def run_command(args: list[str], timeout: int = 20) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        return {"ok": False, "returncode": 127, "stdout": "", "stderr": "command not found"}
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": None,
            "stdout": exc.stdout or "",
            "stderr": f"timed out after {timeout}s",
        }
    return {
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "stdout": proc.stdout.strip(),
        "stderr": proc.stderr.strip(),
    }


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def auth_state(profile: str) -> dict[str, Any]:
    home = Path(os.environ.get("NOTEBOOKLM_HOME", Path.home() / ".notebooklm")).expanduser()
    profile_file = home / "profiles" / profile / "storage_state.json"
    legacy_file = home / "storage_state.json"
    inline_auth = bool(os.environ.get("NOTEBOOKLM_AUTH_JSON"))
    candidates = [profile_file, legacy_file]
    existing = [str(p) for p in candidates if p.exists()]
    return {
        "notebooklm_home": str(home),
        "profile": profile,
        "has_inline_auth_json": inline_auth,
        "storage_files_found": existing,
        "has_any_auth_material": inline_auth or bool(existing),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    parser.add_argument("--profile", default=os.environ.get("NOTEBOOKLM_PROFILE", "default"))
    parser.add_argument("--auth-test", action="store_true", help="run notebooklm auth check --test")
    parser.add_argument("--strict", action="store_true", help="exit non-zero when not ready")
    args = parser.parse_args()

    notebooklm_path = shutil.which("notebooklm")
    result: dict[str, Any] = {
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "notebooklm_cli": notebooklm_path,
        "notebooklm_py_version": package_version("notebooklm-py"),
        "playwright_version": package_version("playwright"),
        "auth": auth_state(args.profile),
        "checks": {},
    }

    if notebooklm_path:
        result["checks"]["version"] = run_command(["notebooklm", "--version"], timeout=15)
        result["checks"]["help"] = run_command(["notebooklm", "--help"], timeout=15)
        if args.auth_test:
            result["checks"]["auth_test"] = run_command(
                ["notebooklm", "auth", "check", "--test", "--json"],
                timeout=60,
            )

    ready = bool(notebooklm_path) and result["auth"]["has_any_auth_material"]
    if args.auth_test:
        ready = ready and bool(result["checks"].get("auth_test", {}).get("ok"))
    result["ready_for_notebooklm"] = ready
    result["needs"] = []
    if not notebooklm_path:
        result["needs"].append('Install notebooklm-py, usually: pip install "notebooklm-py[browser]"')
    if not result["auth"]["has_any_auth_material"]:
        result["needs"].append("Authenticate with: notebooklm login")
    if args.auth_test and not result["checks"].get("auth_test", {}).get("ok"):
        result["needs"].append("Refresh or repair Google auth: notebooklm login")

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"NotebookLM CLI: {notebooklm_path or 'missing'}")
        print(f"notebooklm-py: {result['notebooklm_py_version'] or 'not installed'}")
        print(f"Auth material: {'yes' if result['auth']['has_any_auth_material'] else 'no'}")
        print(f"Ready: {'yes' if ready else 'no'}")
        for need in result["needs"]:
            print(f"- {need}")

    return 1 if args.strict and not ready else 0


if __name__ == "__main__":
    raise SystemExit(main())
