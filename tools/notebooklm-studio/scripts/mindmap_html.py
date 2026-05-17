#!/usr/bin/env python3
"""Convert a NotebookLM mind-map JSON file into a self-contained interactive HTML view."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any


def normalize_node(value: Any, fallback_name: str = "Untitled") -> dict[str, Any]:
    if isinstance(value, str):
        return {"name": value, "children": []}
    if isinstance(value, list):
        return {
            "name": fallback_name,
            "children": [normalize_node(child, f"Item {index + 1}") for index, child in enumerate(value)],
        }
    if not isinstance(value, dict):
        return {"name": str(value), "children": []}

    name = (
        value.get("name")
        or value.get("title")
        or value.get("label")
        or value.get("text")
        or fallback_name
    )
    raw_children = (
        value.get("children")
        or value.get("nodes")
        or value.get("items")
        or value.get("branches")
        or []
    )
    if isinstance(raw_children, dict):
        raw_children = [
            {"name": key, "children": child if isinstance(child, list) else [child]}
            for key, child in raw_children.items()
        ]
    if not isinstance(raw_children, list):
        raw_children = []
    return {
        "name": str(name),
        "children": [normalize_node(child, f"{name} {index + 1}") for index, child in enumerate(raw_children)],
    }


def count_nodes(node: dict[str, Any]) -> int:
    return 1 + sum(count_nodes(child) for child in node.get("children", []))


def html_document(data: dict[str, Any], title: str) -> str:
    safe_title = html.escape(title)
    payload = json.dumps(data, ensure_ascii=False)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f3f2ec;
      --paper: #fffdfa;
      --panel: #ffffff;
      --ink: #171717;
      --muted: #66645e;
      --line: #dad5c9;
      --soft-line: #ece8de;
      --accent: #0f766e;
      --accent-soft: #dff5ef;
      --amber: #b45309;
      --shadow: 0 18px 45px rgba(32, 30, 24, .10);
      --radius: 8px;
    }}
    * {{ box-sizing: border-box; }}
    html {{ background: var(--bg); }}
    body {{
      margin: 0;
      min-height: 100vh;
      background:
        linear-gradient(rgba(15, 118, 110, .035) 1px, transparent 1px),
        linear-gradient(90deg, rgba(15, 118, 110, .035) 1px, transparent 1px),
        var(--bg);
      background-size: 28px 28px;
      color: var(--ink);
      font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", sans-serif;
    }}
    header {{
      position: sticky;
      top: 0;
      z-index: 20;
      display: grid;
      grid-template-columns: minmax(220px, 1fr) minmax(220px, 360px) auto auto auto;
      gap: 10px;
      align-items: center;
      padding: 12px 16px;
      background: rgba(253, 252, 248, .94);
      border-bottom: 1px solid var(--line);
      box-shadow: 0 10px 28px rgba(40, 38, 32, .08);
      backdrop-filter: blur(14px);
    }}
    h1 {{
      margin: 0;
      font-size: 16px;
      line-height: 1.25;
      font-weight: 760;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }}
    .controls {{
      display: contents;
    }}
    input, button {{
      min-height: 36px;
      border: 1px solid #d6d1c5;
      background: var(--panel);
      color: var(--ink);
      font: inherit;
      border-radius: 6px;
    }}
    input {{
      width: 100%;
      padding: 0 11px;
    }}
    button {{
      padding: 0 12px;
      cursor: pointer;
      white-space: nowrap;
    }}
    button:hover {{
      border-color: var(--accent);
      background: #f7fffc;
    }}
    main {{
      max-width: 1480px;
      margin: 0 auto;
      padding: 22px 18px 36px;
    }}
    .root-card {{
      position: relative;
      overflow: hidden;
      padding: 24px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background:
        radial-gradient(circle at 16% 8%, rgba(15, 118, 110, .14), transparent 31%),
        radial-gradient(circle at 88% 18%, rgba(180, 83, 9, .10), transparent 30%),
        var(--paper);
      box-shadow: var(--shadow);
    }}
    .root-card::before {{
      content: "";
      position: absolute;
      inset: 14px;
      border: 1px solid rgba(15, 118, 110, .12);
      border-radius: 6px;
      pointer-events: none;
    }}
    .root-title {{
      position: relative;
      margin: 0;
      max-width: 980px;
      font-size: clamp(26px, 4.2vw, 54px);
      line-height: 1.08;
      font-weight: 820;
      letter-spacing: 0;
      overflow-wrap: anywhere;
    }}
    .root-meta {{
      position: relative;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
      color: var(--muted);
    }}
    .chip {{
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 9px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: rgba(255,255,255,.72);
      font-size: 12px;
    }}
    .branch-grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 14px;
      margin-top: 16px;
    }}
    .branch-card {{
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: rgba(255, 255, 255, .92);
      box-shadow: 0 12px 28px rgba(32, 30, 24, .07);
    }}
    .branch-card.hidden {{
      display: none;
    }}
    .branch-head {{
      display: grid;
      grid-template-columns: 28px 1fr auto;
      gap: 10px;
      align-items: start;
      padding: 14px 14px 12px;
      border-bottom: 1px solid var(--soft-line);
      background: linear-gradient(90deg, var(--accent-soft), rgba(255,255,255,0));
    }}
    .branch-number {{
      display: inline-grid;
      place-items: center;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--accent);
      color: #fff;
      font-size: 12px;
      font-weight: 760;
    }}
    .branch-title {{
      margin: 0;
      font-size: 16px;
      line-height: 1.28;
      font-weight: 760;
      overflow-wrap: anywhere;
    }}
    .branch-count {{
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }}
    .tree {{
      margin: 0;
      padding: 12px 12px 14px;
      list-style: none;
    }}
    .tree ul {{
      position: relative;
      margin: 6px 0 0 15px;
      padding: 0 0 0 14px;
      list-style: none;
      border-left: 1px solid var(--soft-line);
    }}
    .tree li {{
      position: relative;
      margin: 6px 0;
    }}
    .node-row, summary {{
      min-width: 0;
      display: grid;
      grid-template-columns: 12px minmax(0, 1fr);
      gap: 8px;
      align-items: start;
      padding: 7px 8px;
      border-radius: 6px;
      color: #222;
      overflow-wrap: anywhere;
    }}
    .node-row:hover, summary:hover {{
      background: #f7f4ed;
    }}
    summary {{
      cursor: pointer;
      list-style: none;
      font-weight: 650;
    }}
    summary::-webkit-details-marker {{
      display: none;
    }}
    .dot {{
      width: 8px;
      height: 8px;
      margin-top: 6px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 3px rgba(15, 118, 110, .11);
    }}
    details:not([open]) > summary .dot {{
      background: var(--amber);
      box-shadow: 0 0 0 3px rgba(180, 83, 9, .12);
    }}
    .match > .node-row,
    details.match > summary {{
      background: #fff4df;
      box-shadow: inset 0 0 0 1px rgba(180, 83, 9, .35);
    }}
    .filtered-out {{
      display: none;
    }}
    .empty {{
      display: none;
      margin: 18px 0 0;
      padding: 18px;
      border: 1px dashed var(--line);
      color: var(--muted);
      background: rgba(255,255,255,.7);
      border-radius: var(--radius);
    }}
    .empty.visible {{
      display: block;
    }}
    footer {{
      max-width: 1480px;
      margin: 0 auto;
      padding: 0 18px 22px;
      color: var(--muted);
      font-size: 12px;
    }}
    @media (max-width: 900px) {{
      header {{
        grid-template-columns: 1fr;
      }}
      .controls {{
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 8px;
      }}
      input {{
        grid-column: 1 / -1;
      }}
    }}
    @media (max-width: 560px) {{
      main {{
        padding: 14px 10px 28px;
      }}
      .root-card {{
        padding: 18px;
      }}
      .branch-grid {{
        grid-template-columns: 1fr;
      }}
      .controls {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <header>
    <h1>{safe_title}</h1>
    <div class="controls">
      <input id="search" placeholder="Search nodes" autocomplete="off">
      <button id="expand" type="button">Expand all</button>
      <button id="collapse" type="button">Collapse branches</button>
      <button id="reset" type="button">Reset</button>
    </div>
  </header>
  <main>
    <section class="root-card">
      <h2 class="root-title" id="root-title"></h2>
      <div class="root-meta">
        <span class="chip" id="stats"></span>
        <span class="chip">Search highlights matching nodes</span>
        <span class="chip">Click section titles to expand or collapse</span>
      </div>
    </section>
    <section class="branch-grid" id="map"></section>
    <p class="empty" id="empty">No nodes match your search.</p>
  </main>
  <footer>Generated from NotebookLM mind-map JSON. The JSON remains the official NotebookLM artifact; this HTML is a readable interactive view.</footer>
  <script>
    const rawData = {payload};
    const state = {{
      data: prepare(rawData),
      expanded: new Set(),
      collapsed: new Set(),
      query: ''
    }};
    const map = document.getElementById('map');
    const search = document.getElementById('search');
    const stats = document.getElementById('stats');
    const empty = document.getElementById('empty');
    const rootTitle = document.getElementById('root-title');

    function prepare(node, depth = 0, id = '0') {{
      node.id = id;
      node.depth = depth;
      node.name = String(node.name || 'Untitled');
      node.children = Array.isArray(node.children) ? node.children : [];
      node.children.forEach((child, index) => prepare(child, depth + 1, `${{id}}-${{index}}`));
      return node;
    }}

    function walk(node, callback) {{
      callback(node);
      node.children.forEach(child => walk(child, callback));
    }}

    function countAll(node) {{
      let total = 0;
      walk(node, () => total++);
      return total;
    }}

    function countDescendants(node) {{
      return countAll(node) - 1;
    }}

    function textMatches(node, query) {{
      return !query || node.name.toLowerCase().includes(query);
    }}

    function subtreeMatches(node, query) {{
      return textMatches(node, query) || node.children.some(child => subtreeMatches(child, query));
    }}

    function make(tag, className, text) {{
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    }}

    function renderNode(node, query, forceOpen = false) {{
      const li = make('li', subtreeMatches(node, query) ? '' : 'filtered-out');
      if (textMatches(node, query) && query) li.classList.add('match');

      if (node.children.length) {{
        const details = document.createElement('details');
        details.dataset.id = node.id;
        const defaultOpen = node.depth <= 2;
        if ((state.expanded.has(node.id) || forceOpen || query || defaultOpen) && !state.collapsed.has(node.id)) {{
          details.open = true;
        }}
        details.addEventListener('toggle', () => {{
          if (details.open) {{
            state.expanded.add(node.id);
            state.collapsed.delete(node.id);
          }} else {{
            state.expanded.delete(node.id);
            state.collapsed.add(node.id);
          }}
        }});
        if (textMatches(node, query) && query) details.classList.add('match');

        const summary = document.createElement('summary');
        summary.appendChild(make('span', 'dot'));
        summary.appendChild(make('span', '', node.name));
        details.appendChild(summary);

        const ul = document.createElement('ul');
        node.children.forEach(child => ul.appendChild(renderNode(child, query, forceOpen)));
        details.appendChild(ul);
        li.appendChild(details);
      }} else {{
        const row = make('div', 'node-row');
        row.appendChild(make('span', 'dot'));
        row.appendChild(make('span', '', node.name));
        li.appendChild(row);
      }}
      return li;
    }}

    function render() {{
      const query = state.query.trim().toLowerCase();
      rootTitle.textContent = state.data.name;
      map.innerHTML = '';
      let visibleBranches = 0;
      state.data.children.forEach((branch, index) => {{
        if (!subtreeMatches(branch, query)) return;
        visibleBranches++;
        const card = make('article', 'branch-card');
        const head = make('div', 'branch-head');
        head.appendChild(make('span', 'branch-number', String(index + 1)));
        head.appendChild(make('h3', 'branch-title', branch.name));
        head.appendChild(make('span', 'branch-count', `${{countDescendants(branch)}} nodes`));
        card.appendChild(head);

        const ul = make('ul', 'tree');
        branch.children.forEach(child => ul.appendChild(renderNode(child, query, false)));
        if (!branch.children.length) {{
          const item = make('li');
          const row = make('div', 'node-row');
          row.appendChild(make('span', 'dot'));
          row.appendChild(make('span', '', branch.name));
          item.appendChild(row);
          ul.appendChild(item);
        }}
        card.appendChild(ul);
        map.appendChild(card);
      }});
      const total = countAll(state.data);
      const visible = query ? countVisibleMatches(state.data, query) : total;
      stats.textContent = query ? `${{visible}} matches / ${{total}} total nodes` : `${{total}} total nodes`;
      empty.classList.toggle('visible', visibleBranches === 0);
    }}

    function countVisibleMatches(node, query) {{
      let total = 0;
      walk(node, item => {{
        if (textMatches(item, query)) total++;
      }});
      return total;
    }}

    search.addEventListener('input', () => {{
      state.query = search.value;
      render();
    }});
    document.getElementById('expand').addEventListener('click', () => {{
      state.collapsed.clear();
      walk(state.data, node => {{
        if (node.children.length) state.expanded.add(node.id);
      }});
      render();
    }});
    document.getElementById('collapse').addEventListener('click', () => {{
      state.expanded.clear();
      walk(state.data, node => {{
        if (node.children.length) state.collapsed.add(node.id);
      }});
      render();
    }});
    document.getElementById('reset').addEventListener('click', () => {{
      search.value = '';
      state.query = '';
      state.expanded.clear();
      state.collapsed.clear();
      scrollTo({{ top: 0, behavior: 'smooth' }});
      render();
    }});
    render();
  </script>
</body>
</html>
"""


def default_output(input_path: Path) -> Path:
    return input_path.with_suffix(".mind-map.html")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input_json", help="NotebookLM mind-map JSON path")
    parser.add_argument("-o", "--output", help="HTML output path")
    parser.add_argument("--title", help="HTML title")
    parser.add_argument("--json", action="store_true", help="print machine-readable result")
    args = parser.parse_args()

    input_path = Path(args.input_json).expanduser()
    output_path = Path(args.output).expanduser() if args.output else default_output(input_path)
    raw = json.loads(input_path.read_text(encoding="utf-8"))
    data = normalize_node(raw, input_path.stem)
    title = args.title or data["name"]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(html_document(data, title), encoding="utf-8")

    result = {
        "ok": True,
        "input": str(input_path.resolve()),
        "output": str(output_path.resolve()),
        "title": title,
        "node_count": count_nodes(data),
    }
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False, sort_keys=True))
    else:
        print(result["output"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
