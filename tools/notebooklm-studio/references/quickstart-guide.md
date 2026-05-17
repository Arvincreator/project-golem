# NotebookLM Studio Quickstart Guide

Use this guide after first-time setup or whenever the user asks how to use the skill.

## What The First Experience Should Feel Like

A new user should not need to understand `notebooklm-py`, Playwright, Google cookies, CLI profiles, or output flags. They should be able to say something like:

```text
用 NotebookLM Studio 把這些資料做成 podcast、slide deck、mind map 和表格。
```

Codex should then:

1. Check whether the NotebookLM CLI exists.
2. Install the CLI and browser support if the user approves.
3. Start Google login when needed.
4. Wait for the user to complete login manually.
5. Verify authentication.
6. Classify sources and warn about risks.
7. Create or reuse a notebook.
8. Submit requested official NotebookLM artifacts as parallel jobs where possible.
9. Poll the shared artifact status table.
10. Download each completed file immediately.
11. Convert mind-map JSON into interactive HTML.
12. Explain which outputs came from NotebookLM and which were derived by Codex.
13. Optionally launch the local dashboard so the user can browse notebooks, run workflows, and hand outputs back to Codex.

## One-Time Setup Commands

Environment check:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/bootstrap_notebooklm.py --json --print-guide
```

Install dependencies after user approval:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/bootstrap_notebooklm.py --install --print-guide
```

Start Google login and verify auth:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/bootstrap_notebooklm.py --login --auth-test --print-guide
```

The user must manually finish Google login in the browser. Codex can continue after the terminal command returns.

## Launch The Local Dashboard

After setup and login, start the visual control room from the user's active project folder:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/dashboard_server.py \
  --host 127.0.0.1 \
  --port 8765 \
  --profile default \
  --out-dir ./notebooklm_outputs/dashboard
```

Open:

```text
http://127.0.0.1:8765/
```

The dashboard lets the user browse NotebookLM notebooks, inspect sources and official artifacts, run one-click workflow recipes, run native Studio tools, watch job status, download outputs, and show a Codex handoff prompt for completed dashboard jobs.

If `8765` is occupied, use another local port:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/dashboard_server.py \
  --host 127.0.0.1 \
  --port 8766 \
  --profile default \
  --out-dir ./notebooklm_outputs/dashboard
```

Keep the dashboard bound to `127.0.0.1` unless the user explicitly asks for network access and understands the risk.

## Normal Use Through Codex

The user can speak naturally:

```text
請把 /path/to/report.pdf 和這個網址做成 Audio Overview、Mind Map、Slide Deck、Infographic 和 Data Table，輸出繁體中文。
```

Codex should translate that into a manifest, plan, run, and verification sequence.

## Useful Direct Commands

Build a source manifest:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/source_manifest.py \
  /path/to/report.pdf \
  https://example.com/article \
  https://www.youtube.com/watch?v=VIDEO_ID
```

Dry-run a full NotebookLM workflow:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/artifact_pipeline.py plan \
  --notebook-title "Market Research" \
  --source /path/to/report.pdf \
  --source https://example.com/article \
  --artifact audio \
  --artifact report \
  --artifact mind-map \
  --artifact slide-deck \
  --artifact infographic \
  --artifact data-table \
  --download \
  --download-slide-format both \
  --out-dir ./notebooklm_outputs
```

Run it for real after authentication is ready:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/artifact_pipeline.py run \
  --notebook-title "Market Research" \
  --source /path/to/report.pdf \
  --source https://example.com/article \
  --artifact audio \
  --artifact report \
  --artifact mind-map \
  --artifact slide-deck \
  --artifact infographic \
  --artifact data-table \
  --download \
  --download-slide-format both \
  --status-file ./notebooklm_outputs/market-research-jobs.json \
  --out-dir ./notebooklm_outputs
```

Convert an existing NotebookLM mind-map JSON to an interactive HTML view:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/mindmap_html.py \
  ./notebooklm_outputs/mind-map.json \
  -o ./notebooklm_outputs/mind-map.html
```

Run the dashboard helper smoke test:

```bash
python ~/.codex/skills/notebooklm-studio/scripts/dashboard_smoke_test.py
```

## Examples

### 1. A founder briefing from PDFs and URLs

```text
用 NotebookLM Studio 讀這三份 PDF 和兩個競品網站，生成一份 board briefing、data table、slide deck 和 podcast。語言用繁體中文，觀點要尖銳，不要泛泛而談。
```

Best artifact plan: `report`, `data-table`, `slide-deck`, `audio`.

### 2. A learning pack from a YouTube lecture

```text
把這個 YouTube 課程做成 study guide、quiz、flashcards 和 mind map，幫我準備考試。
```

Best artifact plan: `report --report-format study-guide`, `quiz`, `flashcards`, `mind-map`.

### 3. A visual explainer package

```text
把這份研究報告變成 Video Overview、Infographic 和 Presenter Slides，讓普通人 5 分鐘內明白。
```

Best artifact plan: `video`, `infographic`, `slide-deck`.

### 4. Deep analysis JSON

```text
根據這些來源輸出 deep-analysis JSON，包含 thesis、evidence、counterarguments、risks、opportunities、citations。
```

Best path: use NotebookLM `ask --json` as the grounded layer. This is a derived Codex deliverable unless NotebookLM adds a native deep-analysis JSON artifact.

## Practical Tips

- Good sources matter more than fancy prompts. A clean, bounded source set produces better artifacts.
- NotebookLM imports YouTube transcripts, not the full video visuals.
- Web URLs import text, not every embedded image or nested page.
- Video and slide artifacts can take several minutes or longer.
- Multi-artifact runs should use the pipeline so a failed or slow video does not block the other outputs.
- Mind maps should be returned as both official JSON and interactive HTML for easier reading.
- Some outputs depend on account plan, age-gated access, region, and rollout status.
- Always separate official NotebookLM artifacts from Codex-derived artifacts in the final answer.
- For important business, legal, medical, or financial content, verify citations and source coverage before sharing.
