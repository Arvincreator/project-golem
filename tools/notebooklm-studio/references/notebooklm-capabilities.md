# NotebookLM Capabilities Reference

Last checked: 2026-05-15.

## What NotebookLM Is For

NotebookLM is a source-grounded research assistant. It uploads or imports sources into a notebook, answers questions against those sources with citations, and creates Studio artifacts from the notebook.

The important design point for Codex: NotebookLM is not a generic model endpoint. It is strongest when the user provides a bounded source set and wants grounded outputs from that set.

## Supported Source Types

Officially documented source types include:

- PDFs, TXT, Markdown, DOCX, CSV, PPTX, ePub.
- Google Docs, Google Slides, and Google Sheets.
- Web URLs.
- Public YouTube URLs with captions.
- Copy/pasted text.
- Audio files such as MP3, WAV, M4A, MP4, OGG, and other supported audio containers.
- Images such as JPG, PNG, WEBP, GIF, HEIC, TIFF, and related formats.

Important limits and behavior:

- Standard notebooks support up to 50 sources. Paid tiers raise this limit.
- Each source can contain up to 500,000 words or an uploaded file up to 200 MB.
- Web URL import uses page text. Images, embedded videos, nested pages, and paywalled pages are not imported as rich visual context.
- YouTube import uses the transcript/captions only. Private videos, videos without speech, videos without captions, unsafe videos, and very new videos may fail.
- Imported Drive files become static copies. Later edits usually need manual sync or reimport.
- NotebookLM may refuse or partially answer if sources are unsafe, unclear, too short, inaccessible, or do not contain the requested information.

## Official Studio Outputs

Current NotebookLM Studio outputs include:

| Output | Use | Typical export/download |
| --- | --- | --- |
| Audio Overview | Podcast-style or brief narrated summary | Audio/video container, often `.mp4` through CLI downloads |
| Video Overview | Narrated visual summary | `.mp4` |
| Cinematic Video Overview | Richer video style, account/age/language limited | `.mp4` |
| Reports | Briefing document, study guide, FAQ-style/custom reports | Docs export in UI; Markdown through CLI |
| Mind Map | Branching visual topic map | Downloadable map; JSON through CLI |
| Flashcards | Study cards with progress UI | CSV in UI; JSON/Markdown/HTML through CLI |
| Quizzes | Interactive quiz questions | JSON/Markdown/HTML through CLI |
| Infographic | Single visual summary | `.png` |
| Slide Deck | Presentation-ready deck | PDF and PowerPoint |
| Data Table | Structured extraction/comparison table | Google Sheets in UI; CSV through CLI |

Feature availability can vary by account age, Google account type, mobile vs desktop, region, plan, and release rollout. Infographics, slide decks, cinematic video, and some high-limit usage may require age-gated or paid access.

## Limits To Mention When Relevant

NotebookLM Standard has lower daily generation limits than Plus, Pro, Ultra, Workspace, or Cloud/Enterprise plans. At the time of this check, Google documents Standard limits such as 100 notebooks/user, 50 sources/notebook, 50 chats/day, 3 audio generations/day, 3 video generations/day, 10 reports/day, 10 quizzes/day, 10 flashcards/day, and 10 mind maps/day. Paid tiers raise limits substantially.

Do not hardcode these limits into user promises. Treat them as subject to change and verify if a workflow depends on them.

## Accuracy And Privacy Notes

- NotebookLM artifacts are AI-generated and can contain factual, visual, or audio inaccuracies.
- Audio and video can contain glitches.
- Google states that NotebookLM answers are based on uploaded sources, but the user should still verify important claims.
- For consumer accounts, user data handling differs from Workspace/Enterprise terms. Avoid uploading confidential material unless the user confirms the account and policy are appropriate.

## Source URLs Checked

- https://support.google.com/notebooklm/answer/16164461
- https://support.google.com/notebooklm/answer/16215270
- https://support.google.com/notebooklm/answer/16206563
- https://support.google.com/notebooklm/answer/16212820
- https://support.google.com/notebooklm/answer/16454555
- https://support.google.com/notebooklm/answer/16212283
- https://support.google.com/notebooklm/answer/16958963
- https://support.google.com/notebooklm/answer/16758265
- https://support.google.com/notebooklm/answer/16757456
- https://support.google.com/notebooklm/answer/16213268
- https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-data-tables/
- https://blog.google/innovation-and-ai/models-and-research/google-labs/8-ways-to-make-the-most-out-of-slide-decks-in-notebooklm/
