const state = {
  notebooks: [],
  overviews: new Map(),
  loadingOverviews: new Set(),
  currentNotebook: null,
  filter: "all",
  query: "",
  jobs: [],
  copiedPrompts: new Set(),
};

const recipes = [
  {
    id: "executive-briefing-suite",
    name: "Executive Briefing Suite",
    purpose: "Help leadership quickly grasp key findings, decision rationale, and presentation-ready materials.",
    artifacts: ["Briefing Report", "Slide Deck", "Data Table", "Audio Overview"],
    native: ["report", "slide-deck", "data-table", "audio"],
  },
  {
    id: "visual-story-suite",
    name: "Visual Story Suite",
    purpose: "Turn complex material into a visual narrative for external presentations or internal alignment.",
    artifacts: ["Video Overview", "Slide Deck", "Infographic", "Mind Map"],
    native: ["video", "slide-deck", "infographic", "mind-map"],
  },
  {
    id: "learning-masterpack",
    name: "Learning Masterpack",
    purpose: "Convert sources into study and review materials for courses, training, and research.",
    artifacts: ["Study Guide Report", "Quiz", "Flashcards", "Mind Map", "Audio Overview"],
    native: ["report", "quiz", "flashcards", "mind-map", "audio"],
  },
  {
    id: "competitive-intel-suite",
    name: "Competitive Intel Suite",
    purpose: "Frame competitors, risks, differentiation, and market position with native NotebookLM artifacts.",
    artifacts: ["Custom Report", "Data Table", "Slide Deck", "Infographic"],
    native: ["report", "data-table", "slide-deck", "infographic"],
  },
  {
    id: "due-diligence-suite",
    name: "Due Diligence Review Suite",
    purpose: "Surface red flags, open questions, evidence maps, and decision summaries from large source sets.",
    artifacts: ["Custom Report", "Data Table", "Mind Map", "Quiz"],
    native: ["report", "data-table", "mind-map", "quiz"],
  },
  {
    id: "content-distribution-suite",
    name: "Content Distribution Suite",
    purpose: "Repurpose one source set into distribution-ready assets grounded in NotebookLM outputs.",
    artifacts: ["Blog-post Report", "Video Overview", "Infographic", "Slide Deck"],
    native: ["report", "video", "infographic", "slide-deck"],
  },
  {
    id: "research-synthesis-suite",
    name: "Research Synthesis Suite",
    purpose: "Turn large source libraries into a grounded research brief, evidence map, and reusable extraction table.",
    artifacts: ["Research Report", "Mind Map", "Data Table", "Audio Overview"],
    native: ["report", "mind-map", "data-table", "audio"],
  },
  {
    id: "stakeholder-qa-suite",
    name: "Stakeholder Q&A Suite",
    purpose: "Prepare for meetings, interviews, and reviews with crisp talking points plus recall checks.",
    artifacts: ["Briefing Report", "Slide Deck", "Quiz", "Flashcards"],
    native: ["report", "slide-deck", "quiz", "flashcards"],
  },
  {
    id: "knowledge-base-digest-suite",
    name: "Knowledge Base Digest Suite",
    purpose: "Refresh a notebook into a compact digest, structured table, map, and listenable summary.",
    artifacts: ["Digest Report", "Data Table", "Mind Map", "Audio Overview"],
    native: ["report", "data-table", "mind-map", "audio"],
  },
];

const studioActions = [
  ["audio", "Audio Overview", "Podcast-style summary"],
  ["slide-deck", "Slide Deck", "PDF + PPTX presentation"],
  ["video", "Video Overview", "Narrated visual explainer"],
  ["mind-map", "Mind Map", "Interactive concept graph"],
  ["report", "Report", "Briefing / study guide / blog post"],
  ["flashcards", "Flashcards", "Study card deck"],
  ["quiz", "Quiz", "Interactive assessment"],
  ["infographic", "Infographic", "Single visual summary"],
  ["data-table", "Data Table", "Structured CSV extraction"],
];

const PREVIEW_NOTE = "Preview only - not submitted to NotebookLM";
const REAL_NOTE = "Submitted through NotebookLM CLI";

const artifactLabels = {
  audio: "Audio",
  video: "Video",
  report: "Report",
  slides: "Slides",
  "slide-deck": "Slides",
  "mind-map": "Mind Map",
  table: "Table",
  "data-table": "Table",
  quiz: "Quiz",
  flashcards: "Cards",
  infographic: "Info",
};

const els = {};

document.addEventListener("DOMContentLoaded", async () => {
  bindElements();
  bindEvents();
  installWheelScrollFallback();
  renderRecipes();
  renderStudioActions();
  await loadNotebooks();
  await pollJobs();
  setInterval(pollJobs, 5000);
});

function bindElements() {
  [
    "libraryView",
    "detailView",
    "notebookGrid",
    "librarySearch",
    "filterPills",
    "totalNotebooks",
    "readyCount",
    "needsReviewCount",
    "backButton",
    "homeButton",
    "detailTitle",
    "detailMeta",
    "sourceList",
    "sourceCountBadge",
    "artifactCountBadge",
    "recipeList",
    "studioGrid",
    "timeline",
    "commandButton",
    "commandOverlay",
    "commandInput",
    "commandResults",
    "clearJobsButton",
    "recipeHelpButton",
    "runnerStatus",
  ].forEach((id) => (els[id] = document.getElementById(id)));
}

function bindEvents() {
  els.librarySearch.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    renderNotebooks();
    hydrateVisibleOverviews();
  });

  els.filterPills.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    state.filter = button.dataset.filter;
    [...els.filterPills.querySelectorAll("button")].forEach((item) => item.classList.toggle("active", item === button));
    renderNotebooks();
    hydrateVisibleOverviews();
  });

  els.backButton.addEventListener("click", showLibrary);
  els.homeButton.addEventListener("click", showLibrary);
  els.commandButton.addEventListener("click", openCommand);
  els.commandOverlay.addEventListener("click", (event) => {
    if (event.target === els.commandOverlay) closeCommand();
  });
  els.commandInput.addEventListener("input", renderCommandResults);
  els.clearJobsButton.addEventListener("click", async () => {
    try {
      const result = await fetchJson("/api/jobs", { method: "DELETE" });
      state.jobs = (result.jobs || []).map(normalizeJob);
    } catch {
      state.jobs = [];
    }
    renderTimeline();
    updateRunnerStatus();
  });
  els.recipeHelpButton.addEventListener("click", () => {
    addLocalJob({
      label: "Background Runner onboarding",
      kind: "guide",
      artifacts: ["Start server", "Connect CLI", "Submit real jobs"],
      progress: 100,
      status: "ready",
      steps: [
        { name: "Prompt: Launch NotebookLM Dashboard", status: "done" },
        { name: "Server: python3 server.py --port 8765", status: "done" },
        { name: "Buttons: submit NotebookLM generate commands", status: "done" },
      ],
    });
  });

  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openCommand();
    }
    if (event.key === "Escape") closePromptPanel();
    if (event.key === "Escape") closeCommand();
  });

  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      document.body.dataset.theme = button.dataset.themeChoice;
      document.querySelectorAll("[data-theme-choice]").forEach((item) => item.classList.toggle("active", item === button));
    });
  });
}

function installWheelScrollFallback() {
  window.addEventListener("wheel", (event) => {
    if (event.defaultPrevented || (!event.deltaY && !event.deltaX)) return;
    const target = event.target instanceof Element ? event.target : null;
    const root = pageScroller();
    const scrollConsumer = findScrollableConsumer(target, event.deltaX, event.deltaY);
    if (scrollConsumer && scrollConsumer !== root) return;
    const beforeTop = root.scrollTop;
    const beforeLeft = root.scrollLeft;
    requestAnimationFrame(() => {
      if (root.scrollTop !== beforeTop || root.scrollLeft !== beforeLeft) return;
      try {
        root.scrollTop = beforeTop + event.deltaY;
        root.scrollLeft = beforeLeft + event.deltaX;
      } catch {
        // Some embedded browsers expose read-only document scroll APIs; native wheel scrolling still handles the app shell.
      }
    });
  }, { passive: true });
}

function pageScroller() {
  return document.querySelector(".app-shell") || document.scrollingElement || document.documentElement;
}

function findScrollableConsumer(target, deltaX, deltaY) {
  for (let node = target; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const canScrollY = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
    const canScrollX = /(auto|scroll|overlay)/.test(style.overflowX) && node.scrollWidth > node.clientWidth;
    const hasYRoom = deltaY < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight;
    const hasXRoom = deltaX < 0 ? node.scrollLeft > 0 : node.scrollLeft + node.clientWidth < node.scrollWidth;
    if ((canScrollY && hasYRoom) || (canScrollX && hasXRoom)) return node;
  }
  return null;
}

async function loadNotebooks() {
  const data = await fetchJson("/api/notebooks");
  state.notebooks = data.notebooks || [];
  renderNotebooks();
  hydrateVisibleOverviews();
}

async function hydrateVisibleOverviews() {
  const visible = filteredNotebooks().slice(0, 12);
  for (const notebook of visible) {
    fetchOverview(notebook);
    await sleep(120);
  }
}

async function fetchOverview(notebook) {
  if (!notebook?.id || state.overviews.has(notebook.id) || state.loadingOverviews.has(notebook.id)) return null;
  state.loadingOverviews.add(notebook.id);
  try {
    const overview = await fetchJson(`/api/notebook/${notebook.id}/overview`);
    state.overviews.set(notebook.id, overview);
    renderNotebooks();
    updateStats();
    if (state.currentNotebook?.id === notebook.id) renderDetail();
    return overview;
  } catch {
    return null;
  } finally {
    state.loadingOverviews.delete(notebook.id);
  }
}

function filteredNotebooks() {
  return state.notebooks.filter((notebook) => {
    const overview = state.overviews.get(notebook.id);
    const haystack = `${notebook.display_title} ${notebook.id} ${notebook.created_at}`.toLowerCase();
    if (state.query && !haystack.includes(state.query)) return false;
    if (state.filter === "empty") return notebook.warnings?.empty_title;
    if (state.filter === "warning") return notebook.warnings?.empty_title || notebook.warnings?.possible_duplicate || overview?.failed_count;
    if (state.filter === "ready") return overview?.status === "Ready";
    return true;
  });
}

function renderNotebooks() {
  const template = document.getElementById("notebookCardTemplate");
  els.notebookGrid.innerHTML = "";
  for (const notebook of filteredNotebooks()) {
    const overview = state.overviews.get(notebook.id);
    const card = template.content.firstElementChild.cloneNode(true);
    const status = overview?.status || (notebook.warnings?.empty_title ? "Needs review" : "Scanning");
    const activityAt = overview?.last_activity || notebook.created_at;
    card.querySelector(".status-badge").textContent = status;
    card.querySelector(".status-badge").classList.toggle("status-ready", status === "Ready");
    card.querySelector(".status-badge").classList.toggle("status-warning", status !== "Ready" && status !== "Has failed artifact");
    card.querySelector(".status-badge").classList.toggle("status-failed", status === "Has failed artifact");
    card.querySelector(".date-chip").textContent = `Synced ${formatDate(notebook.created_at)}`;
    card.querySelector("h3").textContent = notebook.display_title;
    card.querySelector(".id-line").textContent = notebook.id;
    card.querySelector('[data-field="source-count"]').textContent = overview?.source_count ?? "…";
    card.querySelector('[data-field="artifact-count"]').textContent = overview?.artifact_count ?? "…";
    card.querySelector('[data-field="last-activity"]').textContent = activityAt ? formatDate(activityAt) : "sync";
    const strip = card.querySelector(".artifact-strip");
    const kinds = overview?.completed_kinds?.length ? overview.completed_kinds : ["audio", "video", "report", "slides", "table"].slice(0, 3);
    kinds.forEach((kind) => {
      const pill = document.createElement("span");
      pill.className = `artifact-pill ${overview?.completed_kinds?.includes(kind) ? "done" : ""}`;
      pill.textContent = artifactLabels[kind] || kind;
      strip.appendChild(pill);
    });
    card.addEventListener("click", () => openNotebook(notebook));
    els.notebookGrid.appendChild(card);
  }
  updateStats();
}

function updateStats() {
  const ready = [...state.overviews.values()].filter((overview) => overview.status === "Ready").length;
  const review = state.notebooks.filter((notebook) => notebook.warnings?.empty_title).length
    + [...state.overviews.values()].filter((overview) => overview.failed_count > 0).length;
  els.totalNotebooks.textContent = state.notebooks.length;
  els.readyCount.textContent = ready || "—";
  els.needsReviewCount.textContent = review;
}

async function openNotebook(notebook) {
  state.currentNotebook = notebook;
  els.libraryView.classList.remove("active");
  els.detailView.classList.add("active");
  renderDetail();
  if (!state.overviews.has(notebook.id)) {
    await fetchOverview(notebook);
  }
}

function showLibrary() {
  els.detailView.classList.remove("active");
  els.libraryView.classList.add("active");
  state.currentNotebook = null;
}

function renderDetail() {
  const notebook = state.currentNotebook;
  if (!notebook) return;
  const overview = state.overviews.get(notebook.id);
  els.detailTitle.textContent = notebook.display_title;
  const activityAt = overview?.last_activity || notebook.created_at;
  els.detailMeta.textContent = `${notebook.id} · Latest activity ${formatDate(activityAt)} · ${overview?.status || "Scanning"}`;
  renderSources(overview?.sources, Boolean(overview));
  renderArtifacts(overview?.artifacts || []);
  renderTimeline();
}

function renderSources(sources, hasSynced = true) {
  const sourceItems = Array.isArray(sources) ? sources : [];
  els.sourceCountBadge.textContent = hasSynced ? (sourceItems.length || "—") : "sync";
  els.sourceList.innerHTML = "";
  if (!hasSynced) {
    els.sourceList.innerHTML = `<div class="source-item"><strong>Syncing sources...</strong></div>`;
    return;
  }
  if (!sourceItems.length) {
    els.sourceList.innerHTML = `<div class="source-item"><strong>No sources found</strong></div>`;
    return;
  }
  sourceItems.forEach((source) => {
    const item = document.createElement("div");
    item.className = "source-item";
    item.innerHTML = `
      <strong>${escapeHtml(displaySourceTitle(source))}</strong>
    `;
    els.sourceList.appendChild(item);
  });
}

function displaySourceTitle(source) {
  const title = String(source?.title || "").trim();
  if (!title) return "Untitled source";
  if (title === "\u8cbc\u4e0a\u7684\u6587\u5b57") return "Pasted text";
  return title;
}

function displaySourceType(value) {
  const raw = String(value || "Source").trim();
  const known = {
    "SourceType.PASTED_TEXT": "Pasted text",
    PASTED_TEXT: "Pasted text",
    "SourceType.URL": "Web source",
    URL: "Web source",
    "SourceType.PDF": "PDF",
    PDF: "PDF",
    "SourceType.DOC": "Document",
    "SourceType.DOCX": "Document",
    DOC: "Document",
    DOCX: "Document",
  };
  if (known[raw]) return known[raw];
  return raw
    .replace(/^SourceType\./, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStatus(value) {
  return String(value || "unknown")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderRecipes() {
  els.recipeList.innerHTML = "";
  recipes.forEach((recipe) => {
    const card = document.createElement("article");
    card.className = "recipe-card";
    card.innerHTML = `
      <h4>${escapeHtml(recipe.name)}</h4>
      <p>${escapeHtml(recipe.purpose)}</p>
      <div class="output-chips">${recipe.artifacts.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      <button class="run-button" type="button" aria-label="Start ${escapeHtml(recipe.name)}">Start</button>
    `;
    card.querySelector("button").addEventListener("click", () => startJob(recipe.name, "recipe", recipe.artifacts, recipe.native, recipe.purpose));
    els.recipeList.appendChild(card);
  });
}

function renderStudioActions() {
  els.studioGrid.innerHTML = "";
  studioActions.forEach(([id, label, description]) => {
    const button = document.createElement("button");
    button.className = "studio-button";
    button.type = "button";
    button.dataset.toolId = id;
    button.innerHTML = `
      <span class="studio-icon">${studioGlyph(id)}</span>
      <span class="studio-copy"><h4>${label}</h4><span class="studio-description">${description}</span></span>
      <span class="tool-arrow" aria-hidden="true">›</span>
    `;
    button.addEventListener("click", () => startJob(label, "native", [label], [id], description));
    els.studioGrid.appendChild(button);
  });
}

function renderArtifacts(artifacts) {
  els.artifactCountBadge.textContent = studioActions.length;
}

async function startJob(label, kind, artifacts, commands = [], purpose = "") {
  if (!state.currentNotebook) return;
  try {
    const result = await fetchJson("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notebook_id: state.currentNotebook.id,
        notebook_title: state.currentNotebook.display_title,
        label,
        kind,
        purpose,
        artifacts,
        commands,
      }),
    });
    if (result.job) addLocalJob(result.job);
  } catch {
    addLocalJob({ label, kind, artifacts, status: "queued", progress: 18, preview: true });
  }
}

function addLocalJob(job) {
  const normalized = normalizeJob(job);
  upsertJob(normalized);
  renderTimeline();
  updateRunnerStatus(normalized);
  document.querySelector(".timeline-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  pollJobs();
}

function normalizeJob(job) {
  return {
    id: job.id || `local-${Date.now()}`,
    notebook_id: job.notebook_id,
    label: job.label,
    kind: job.kind || "task",
    purpose: job.purpose,
    artifacts: job.artifacts || [],
    commands: job.commands || [],
    outputs: job.outputs || [],
    status: job.status || "queued",
    progress: job.progress ?? 3,
    created_at: job.created_at || new Date().toISOString().slice(0, 19),
    updated_at: job.updated_at,
    steps: job.steps || [{ name: "Queued for NotebookLM", status: "active" }],
    preview: Boolean(job.preview),
    output_dir: job.output_dir,
    handoff_path: job.handoff_path,
    global_handoff_path: job.global_handoff_path,
    prompt_path: job.prompt_path || job.agent_prompt_path,
    handoff_status: job.handoff_status,
    prompt_copied: Boolean(job.prompt_copied) || state.copiedPrompts.has(job.id),
    prompt_error: job.prompt_error,
  };
}

function upsertJob(job) {
  const index = state.jobs.findIndex((item) => item.id === job.id);
  if (index >= 0) state.jobs.splice(index, 1, job);
  else state.jobs.unshift(job);
}

async function pollJobs() {
  try {
    const result = await fetchJson("/api/jobs");
    state.jobs = (result.jobs || []).map(normalizeJob);
    renderTimeline();
    updateRunnerStatus();
  } catch {
    // Keep the last visible state if the local runner is temporarily busy.
  }
}

function updateRunnerStatus(job = null) {
  const currentJobs = state.currentNotebook
    ? state.jobs.filter((item) => item.notebook_id === state.currentNotebook.id)
    : state.jobs;
  const latest = job || currentJobs[0];
  if (!latest) {
    els.runnerStatus.textContent = "Ready · submits jobs through NotebookLM CLI";
    return;
  }
  els.runnerStatus.textContent = `${latest.label} · ${latest.status} · ${latest.preview ? PREVIEW_NOTE : REAL_NOTE}`;
}

async function copyPromptToAgent(jobId) {
  let result;
  try {
    result = await fetchJson("/api/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job_id: jobId }),
    });
  } catch {
    const job = state.jobs.find((item) => item.id === jobId);
    if (job) {
      job.prompt_error = "Prompt request failed";
      renderTimeline();
    }
    return;
  }

  const job = state.jobs.find((item) => item.id === jobId);
  if (!job) return;
  job.handoff_path = result.path;
  job.global_handoff_path = result.global_path;
  job.prompt_path = result.prompt_path;

  if (result.ok) {
    showPromptPanel(result.prompt, result.prompt_path);
    job.handoff_status = "prompt_ready";
    job.prompt_error = "Prompt is selected in the popup. Press Command+C, then paste with Command+V.";
    updateRunnerStatus(job);
    renderTimeline();
  } else {
    job.prompt_error = result.error || "Prompt is not ready yet";
    renderTimeline();
  }
}

function showPromptPanel(prompt, promptPath) {
  let overlay = document.getElementById("promptOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "promptOverlay";
    overlay.className = "prompt-overlay";
    overlay.innerHTML = `
      <section class="prompt-panel" role="dialog" aria-modal="true" aria-labelledby="promptPanelTitle">
        <div class="prompt-panel-head">
          <div>
            <p class="section-label">Agent Handoff</p>
            <h3 id="promptPanelTitle">Prompt ready</h3>
          </div>
          <button class="tiny-button" type="button" data-prompt-close>Close</button>
        </div>
        <p class="prompt-status" data-prompt-status></p>
        <textarea class="prompt-textarea" spellcheck="false" readonly data-prompt-text></textarea>
        <div class="prompt-footer">
          <small data-prompt-path></small>
          <div>
            <button class="tiny-button" type="button" data-prompt-select>Select all</button>
            <button class="tiny-button" type="button" data-prompt-close>Close</button>
          </div>
        </div>
      </section>
    `;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay || event.target.closest("[data-prompt-close]")) closePromptPanel();
    });
    overlay.querySelector("[data-prompt-select]").addEventListener("click", () => selectPromptText());
    document.body.appendChild(overlay);
  }

  overlay.querySelector("[data-prompt-text]").value = String(prompt ?? "");
  overlay.querySelector("[data-prompt-path]").textContent = promptPath || "";
  overlay.querySelector("[data-prompt-status]").textContent = "The prompt is selected. Press Command+C to copy, then paste it into Codex with Command+V.";
  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
  selectPromptText();
}

function selectPromptText() {
  const textarea = document.querySelector("#promptOverlay [data-prompt-text]");
  if (!textarea) return;
  setTimeout(() => {
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);
    textarea.scrollTop = 0;
    textarea.scrollLeft = 0;
  }, 20);
}

function closePromptPanel() {
  const overlay = document.getElementById("promptOverlay");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
}

function renderTimeline() {
  els.timeline.innerHTML = "";
  const overview = state.currentNotebook ? state.overviews.get(state.currentNotebook.id) : null;
  const artifactJobs = (overview?.artifacts || []).slice(0, 6).map((artifact) => ({
    id: artifact.id,
    label: artifact.title || artifact.type,
    kind: "native artifact",
    artifacts: [artifact.type],
    status: artifact.status,
    progress: artifact.status === "completed" ? 100 : artifact.status === "failed" ? 100 : 45,
    created_at: artifact.created_at,
    steps: [
      { name: "Submitted", status: "done" },
      { name: artifact.status === "failed" ? "Failed in NotebookLM" : "Generated", status: artifact.status === "failed" ? "failed" : "done" },
      { name: "Download available", status: artifact.status === "completed" ? "done" : "waiting" },
    ],
  }));
  const activeJobs = state.currentNotebook
    ? state.jobs.filter((job) => job.notebook_id === state.currentNotebook.id || job.kind === "guide")
    : state.jobs;
  const jobs = [...activeJobs, ...artifactJobs];
  if (!jobs.length) {
    const emptyTitle = state.currentNotebook && !overview ? "Syncing artifact history..." : "No jobs yet";
    const emptyBody = state.currentNotebook && !overview
      ? "Existing NotebookLM artifacts will appear here after metadata sync."
      : "Start a recipe or native Studio action to see live progress here.";
    els.timeline.innerHTML = `<div class="job-card"><div><strong>${emptyTitle}</strong><small>${emptyBody}</small></div></div>`;
    return;
  }
  jobs.forEach((job) => {
    const outputs = job.outputs || [];
    const hasDownloads = (job.outputs || []).some((output) => output.downloaded_files?.length);
    const isRunnerJob = !job.preview && (job.commands?.length || job.outputs?.length || job.output_dir);
    const isExternalArtifact = job.kind === "native artifact" && !outputs.length;
    const isSingleOutputJob = !isExternalArtifact && outputs.length === 1;
    const canCopyPrompt = isRunnerJob && ["completed", "completed with failures"].includes(job.status) && hasDownloads;
    const actionHint = canCopyPrompt
      ? "Prompt opens selected and ready for Command+C."
      : "Available after downloads finish.";
    const promptDetail = job.prompt_error || actionHint;
    const promptTitle = job.prompt_path || job.global_handoff_path || promptDetail;
    const outputsHtml = job.outputs?.length ? `
      <div class="output-list">${job.outputs.map((output) => `
        <span>
          <strong>${escapeHtml(output.label || output.command)}</strong>
          <em>${escapeHtml(output.status || "queued")}${output.artifact_id ? ` · ${escapeHtml(output.artifact_id)}` : ""}${output.download_status ? ` · ${escapeHtml(output.download_status)}` : ""}</em>
        </span>
      `).join("")}</div>
    ` : "";
    const stepsHtml = (job.steps || []).map((step) => `<span>${step.status === "done" ? "✓" : step.status === "failed" ? "!" : "·"} ${escapeHtml(step.name)}</span>`).join("");
    const card = document.createElement("div");
    card.className = `job-card${isExternalArtifact ? " job-card-summary" : ""}${isSingleOutputJob ? " job-card-single" : ""}`;
    if (isExternalArtifact) {
      const summaryStep = (job.steps || []).find((step) => step.status === "failed")
        || (job.steps || []).find((step) => step.name === "Download available")
        || (job.steps || [])[0];
      const summaryMark = summaryStep?.status === "failed" ? "!" : summaryStep?.status === "done" ? "✓" : "·";
      card.innerHTML = `
        <div class="job-summary-row">
          <div class="job-title-block">
            <strong>${escapeHtml(job.label || "NotebookLM artifact")}</strong>
            <small>${escapeHtml(job.kind || "native artifact")} · ${escapeHtml(job.status || "queued")} · ${formatDate(job.created_at)}</small>
          </div>
          <div class="job-summary-status">
            <span>${summaryMark} ${escapeHtml(summaryStep?.name || formatStatus(job.status))}</span>
            <em>${(job.artifacts || []).map((item) => escapeHtml(item)).join(" · ")}</em>
          </div>
        </div>
        <div class="progress-track"><i style="width:${job.progress || 0}%"></i></div>
      `;
    } else {
      card.innerHTML = `
      <div class="job-header-row">
        <div class="job-title-block">
          <strong>${escapeHtml(job.label || "NotebookLM job")}</strong>
          <small>${escapeHtml(job.kind || "task")} · ${escapeHtml(job.status || "queued")} · ${formatDate(job.created_at)}</small>
        </div>
        ${isRunnerJob ? `<div class="job-action-panel"><button type="button" class="handoff-button" data-job-id="${escapeHtml(job.id)}" ${canCopyPrompt ? "" : "disabled"}>Show Prompt for Codex</button><small title="${escapeHtml(promptTitle)}">${escapeHtml(promptDetail)}</small></div>` : ""}
      </div>
      <div class="job-body">
        <div class="output-chips">${(job.artifacts || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
        ${job.preview ? `<div class="preview-warning">${PREVIEW_NOTE}</div>` : ""}
        <div class="job-status-grid">
          ${outputsHtml || "<div></div>"}
          <div class="step-list">
            ${stepsHtml}
          </div>
        </div>
        <div class="progress-track"><i style="width:${job.progress || 0}%"></i></div>
      </div>
    `;
    }
    card.querySelector(".handoff-button")?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!event.currentTarget.disabled) copyPromptToAgent(job.id);
    });
    els.timeline.appendChild(card);
  });
}

function openCommand() {
  els.commandOverlay.classList.add("active");
  els.commandOverlay.setAttribute("aria-hidden", "false");
  els.commandInput.value = "";
  renderCommandResults();
  setTimeout(() => els.commandInput.focus(), 20);
}

function closeCommand() {
  els.commandOverlay.classList.remove("active");
  els.commandOverlay.setAttribute("aria-hidden", "true");
}

function renderCommandResults() {
  const query = els.commandInput.value.trim().toLowerCase();
  const artifactQuery = {
    audio: "audio",
    video: "video",
    report: "report",
    slides: "slides",
    slide: "slides",
    table: "table",
    data: "table",
    mindmap: "mind-map",
    "mind map": "mind-map",
    infographic: "infographic",
    quiz: "quiz",
    flashcards: "flashcards",
  }[query];
  const results = state.notebooks.filter((notebook) => {
    if (!query) return true;
    if (query === "untitled") return notebook.warnings?.empty_title;
    if (/^\d{4}-\d{2}$/.test(query)) return String(notebook.created_at || "").startsWith(query);
    if (artifactQuery) return state.overviews.get(notebook.id)?.completed_kinds?.includes(artifactQuery);
    return `${notebook.display_title} ${notebook.id}`.toLowerCase().includes(query);
  }).slice(0, 10);
  els.commandResults.innerHTML = "";
  results.forEach((notebook) => {
    const row = document.createElement("button");
    row.className = "command-result";
    row.type = "button";
    row.innerHTML = `
      <span><strong>${escapeHtml(notebook.display_title)}</strong><small>${escapeHtml(notebook.id)} · ${formatDate(notebook.created_at)}</small></span>
      <span class="icon-arrow"></span>
    `;
    row.addEventListener("click", () => {
      closeCommand();
      openNotebook(notebook);
    });
    els.commandResults.appendChild(row);
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json();
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function studioGlyph(id) {
  const icons = {
    audio: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 13v-2m4 6V7m4 13V4m4 12V8m4 5v-2"/><path d="M17 4l.8 1.8L20 6.5l-1.8.8L17.5 9l-.8-1.8L15 6.5l1.8-.7L17 4Z"/></svg>`,
    video: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h12v10H5z"/><path d="M9 4h7M8 20h8M10 10l4 2-4 2z"/></svg>`,
    report: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h9l3 3v13H7z"/><path d="M16 4v4h4M10 11h6M10 15h6M10 18h4"/></svg>`,
    "slide-deck": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v11H4z"/><path d="M8 20h8M12 17v3"/></svg>`,
    "mind-map": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6v5M7 17l5-6 5 6"/><path d="M9 4h6v4H9zM4 15h6v5H4zM14 15h6v5h-6z"/></svg>`,
    "data-table": `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5zM5 10h14M5 15h14M10 5v14M15 5v14"/></svg>`,
    quiz: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/><path d="M9.5 10a2.5 2.5 0 1 1 4.2 1.8c-.8.7-1.2 1-1.2 2.2M12.5 17h.1"/></svg>`,
    flashcards: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v12H7z"/><path d="M4 4h10v12M10 11h4M10 15h3"/><path d="M16 4l.6 1.4L18 6l-1.4.6L16 8l-.6-1.4L14 6l1.4-.6L16 4Z"/></svg>`,
    infographic: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19V9M12 19V5M19 19v-8"/><path d="M4 19h16M9 9h6M16 11h6M2 9h6"/></svg>`,
  };
  return icons[id] || `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"/></svg>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
