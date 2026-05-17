# Source Ingestion Strategy

NotebookLM accepts many source types, but "anything" still needs staging. Codex should normalize the user's inputs before upload and warn early when NotebookLM is likely to reject something.

## Safe Source Policy

Proceed when the source is:

- Uploaded by the user.
- A public URL that is not paywalled.
- A public YouTube URL with captions.
- A local file in the workspace or a path the user explicitly provided.
- A Google Drive source the user can access through their signed-in NotebookLM account.

Do not proceed when the request requires bypassing access controls, scraping paid content, or uploading sensitive/confidential data without explicit confirmation.

## Preparation Pattern

1. Collect source strings exactly as provided.
2. Run `scripts/source_manifest.py` to classify and flag them.
3. For missing local files, ask for the correct path or upload.
4. For unsupported local formats, convert only when the conversion is safe and loss is acceptable:
   - HTML/email/chat exports -> Markdown or TXT.
   - Spreadsheets -> CSV when Sheets import is unavailable.
   - Local video -> transcript/audio extraction for speech; note that visual details are not preserved unless separately described.
   - Images -> upload directly if NotebookLM supports the extension; for dense diagrams, add a Codex-authored OCR/description note if needed.
5. For many sources, group by theme and create multiple notebooks if the source count or token budget will reduce answer quality.

## Upload Priorities

Prefer original rich sources when NotebookLM supports them:

1. Native PDF, PPTX, DOCX, CSV, MD, TXT, ePub.
2. Google Docs/Slides/Sheets through Drive import.
3. Web URL when page text is enough.
4. YouTube URL when captions are available.
5. Pasted text or normalized Markdown when the original format is not reliable.

## Quality Checks After Upload

After adding sources:

```bash
notebooklm source list --json
notebooklm summary
```

For high-value sources, ask a sanity question:

```bash
notebooklm ask "List the sources you can see, their main topics, and any import problems." --json
```

If the answer suggests missing content, stop and repair the source set before generating polished artifacts.
