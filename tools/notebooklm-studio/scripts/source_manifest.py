#!/usr/bin/env python3
"""Classify NotebookLM source inputs and surface upload risks."""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import urlparse


DOCUMENT_EXTENSIONS = {".pdf", ".txt", ".md", ".docx", ".csv", ".pptx", ".epub"}
IMAGE_EXTENSIONS = {
    ".avif", ".bmp", ".gif", ".heic", ".heif", ".ico", ".jp2", ".jpe", ".jpeg",
    ".jpg", ".png", ".tif", ".tiff", ".webp",
}
AUDIO_EXTENSIONS = {
    ".3g2", ".3gp", ".aac", ".aif", ".aifc", ".aiff", ".amr", ".au", ".avi",
    ".cda", ".m4a", ".mid", ".mp3", ".mp4", ".mpeg", ".ogg", ".opus", ".ra",
    ".ram", ".snd", ".wav", ".wma",
}

MAX_STANDARD_SOURCES = 50
MAX_FILE_BYTES = 200 * 1024 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def is_youtube_url(parsed) -> bool:
    host = parsed.netloc.lower()
    return host.endswith("youtube.com") or host.endswith("youtu.be")


def classify_source(raw: str) -> dict:
    value = raw.strip()
    warnings: list[str] = []
    if not value:
        return {"input": raw, "kind": "empty", "supported": False, "warnings": ["empty source"]}

    if value == "-":
        return {
            "input": raw,
            "kind": "stdin-text",
            "supported": True,
            "warnings": ["stdin text needs a clear --title when uploaded"],
        }

    parsed = urlparse(value)
    if parsed.scheme in {"http", "https"}:
        if is_youtube_url(parsed):
            warnings.append("YouTube import requires a public video with captions/transcript")
            kind = "youtube-url"
        elif "docs.google.com" in parsed.netloc.lower():
            warnings.append("Drive URLs may need source add-drive or browser import depending on CLI support")
            kind = "google-drive-url"
        else:
            warnings.append("NotebookLM imports web page text only; paywalled or script-rendered content may fail")
            kind = "web-url"
        return {"input": value, "kind": kind, "supported": True, "warnings": warnings}

    if value.startswith("text:"):
        text_len = len(value.removeprefix("text:").strip())
        return {
            "input": value,
            "kind": "pasted-text",
            "supported": text_len > 0,
            "text_characters": text_len,
            "warnings": [] if text_len else ["empty text payload"],
        }

    path = Path(os.path.expanduser(value))
    if not path.exists():
        return {
            "input": value,
            "kind": "missing-local-path",
            "supported": False,
            "warnings": ["local file does not exist"],
        }

    if path.is_dir():
        return {
            "input": value,
            "path": str(path.resolve()),
            "kind": "directory",
            "supported": False,
            "warnings": ["expand directories into individual files before upload"],
        }

    suffix = path.suffix.lower()
    if suffix in DOCUMENT_EXTENSIONS:
        kind = "document-file"
    elif suffix in IMAGE_EXTENSIONS:
        kind = "image-file"
    elif suffix in AUDIO_EXTENSIONS:
        kind = "audio-file"
    else:
        kind = "unknown-file"
        warnings.append("extension is not in NotebookLM's documented source types; convert first if needed")

    size = path.stat().st_size
    if size > MAX_FILE_BYTES:
        warnings.append("file is larger than NotebookLM's documented 200 MB upload limit")

    mime_type, _ = mimetypes.guess_type(str(path))
    return {
        "input": value,
        "path": str(path.resolve()),
        "kind": kind,
        "supported": kind != "unknown-file" and size <= MAX_FILE_BYTES,
        "extension": suffix,
        "mime_type": mime_type,
        "bytes": size,
        "sha256": sha256_file(path),
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", nargs="*", help="source paths, URLs, text: payloads, or '-'")
    parser.add_argument("--stdin", action="store_true", help="read newline-delimited sources from stdin")
    parser.add_argument("--output", help="write manifest JSON to this path")
    parser.add_argument("--max-standard-sources", type=int, default=MAX_STANDARD_SOURCES)
    parser.add_argument("--allow-unsupported", action="store_true", help="exit 0 even if some sources are unsupported")
    args = parser.parse_args()

    raw_sources = list(args.sources)
    if args.stdin:
        raw_sources.extend(line.rstrip("\n") for line in sys.stdin if line.strip())

    entries = [classify_source(source) for source in raw_sources]
    global_warnings: list[str] = []
    if len(entries) > args.max_standard_sources:
        global_warnings.append(
            f"{len(entries)} sources exceeds the standard {args.max_standard_sources}-source notebook limit"
        )

    manifest = {
        "source_count": len(entries),
        "supported_count": sum(1 for entry in entries if entry.get("supported")),
        "unsupported_count": sum(1 for entry in entries if not entry.get("supported")),
        "warnings": global_warnings,
        "sources": entries,
    }

    payload = json.dumps(manifest, indent=2, sort_keys=True)
    if args.output:
        Path(args.output).write_text(payload + "\n", encoding="utf-8")
    print(payload)
    return 0 if args.allow_unsupported or manifest["unsupported_count"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
