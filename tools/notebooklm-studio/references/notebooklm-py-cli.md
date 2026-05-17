# notebooklm CLI Reference For Codex

The `notebooklm` command is provided by the community package `notebooklm-py`. It is useful for Codex because it exposes NotebookLM workflows through a terminal, but it is not an official Google API. It can break when Google changes internal endpoints, and it needs a real Google session.

## Install And Authenticate

Ask the user before installing or opening a browser login.

```bash
pip install "notebooklm-py[browser]"
playwright install chromium
notebooklm login
notebooklm auth check --test --json
```

Cookie import may also be available:

```bash
pip install "notebooklm-py[cookies]"
notebooklm login --browser-cookies chrome
```

For multiple Google accounts, use profiles:

```bash
notebooklm profile create work
notebooklm -p work login
notebooklm profile switch work
```

Useful environment variables:

- `NOTEBOOKLM_HOME`: base config directory, default `~/.notebooklm`.
- `NOTEBOOKLM_PROFILE`: active profile name.
- `NOTEBOOKLM_NOTEBOOK`: default notebook id.
- `NOTEBOOKLM_AUTH_JSON`: inline auth JSON for CI-style environments.
- `NOTEBOOKLM_HL`: output language default.

## Notebook Commands

```bash
notebooklm list --json
notebooklm create "Research Title" --use --json
notebooklm use NOTEBOOK_ID --json
notebooklm status --json
notebooklm summary
```

`create --use` is preferred because later source, generate, and download commands can use the active notebook context.

## Source Commands

```bash
notebooklm source list --json
notebooklm source add "https://example.com/article" --json
notebooklm source add "./paper.pdf" --json
notebooklm source add - --title "Pasted notes" --json
notebooklm source add-drive FILE_ID "Quarterly deck" --mime-type google-slides --json
notebooklm source wait SOURCE_ID --timeout 300 --json
notebooklm source clean --dry-run --json
```

Use `source wait` when the add response returns a source id and the source needs ingestion time.

## Chat And Grounded Extraction

```bash
notebooklm ask "What are the key findings? Cite sources." --json
notebooklm ask --prompt-file prompt.txt --json --timeout 120
notebooklm ask "Create a JSON brief with risks, opportunities, and citations." --save-as-note --note-title "Deep Analysis"
```

Use `ask --json` for source-grounded custom deliverables that are not direct Studio artifacts.

## Generate Commands

Uniform flags for most artifact types:

- `--wait` to block until generation finishes.
- `--interval SECONDS` for polling cadence.
- `--retry N` to retry on rate limits.
- `--json` for machine-readable results.
- `--language LANG` on language-aware artifacts.
- `--prompt-file PATH` for long prompts.

Examples:

```bash
notebooklm generate audio "Focus on business impact" --format deep-dive --length default --wait --json
notebooklm generate video "Explain this to executives" --format explainer --style whiteboard --no-wait --json
notebooklm generate cinematic-video "Make it documentary style" --no-wait --json
notebooklm generate report "Create a board briefing" --format briefing-doc --wait --json
notebooklm generate report "Use this custom outline" --format custom --wait --json
notebooklm generate mind-map --instructions "Center on strategic themes" --json
notebooklm generate quiz "Exam prep" --difficulty hard --quantity standard --wait --json
notebooklm generate flashcards "Key terms" --difficulty medium --quantity more --wait --json
notebooklm generate infographic "Use a professional style and highlight 3 metrics" --orientation landscape --detail detailed --style professional --wait --json
notebooklm generate slide-deck "Presenter deck for a 10-minute talk" --format presenter --length default --wait --json
notebooklm generate data-table "Compare vendors by pricing, risks, and differentiators" --wait --json
```

## Download Commands

```bash
notebooklm download audio ./audio-overview.mp4 --latest --json
notebooklm download video ./video-overview.mp4 --latest --json
notebooklm download slide-deck ./deck.pdf --format pdf --latest --json
notebooklm download slide-deck ./deck.pptx --format pptx --latest --json
notebooklm download infographic ./infographic.png --latest --json
notebooklm download report ./report.md --latest --json
notebooklm download mind-map ./mind-map.json --latest --json
notebooklm download data-table ./table.csv --latest --json
notebooklm download quiz ./quiz.json --format json --latest --json
notebooklm download flashcards ./flashcards.md --format markdown --latest --json
```

If a download command fails because the CLI or NotebookLM rollout changed, list artifacts with:

```bash
notebooklm artifact list --type all --json
notebooklm artifact wait ARTIFACT_ID --timeout 1200 --json
```

Then download by artifact id if supported.

For long-running multi-artifact jobs, prefer `scripts/artifact_pipeline.py`. It submits generation with `--no-wait` where supported, polls `artifact list`, downloads completed artifacts, and converts mind maps to HTML.

## Troubleshooting

Run these before blaming NotebookLM:

```bash
notebooklm --version
notebooklm doctor --json
notebooklm auth check --test --json
notebooklm status --paths
notebooklm list --limit 5 --json
```

Common causes:

- Google session expired: run `notebooklm login` again.
- Account does not have the feature or quota: generate fewer artifacts, wait for quota reset, or use a supported account.
- Source import failed: check access, captions, file size, supported type, and safety flags.
- CLI/API drift: use the Browser or Chrome plugin to operate NotebookLM UI manually, then update this skill.
