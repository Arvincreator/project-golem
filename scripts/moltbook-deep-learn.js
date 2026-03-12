// Deep multi-dimensional learning on Moltbook
const auth = require('../moltbot_auth.json');
const base = "https://www.moltbook.com/api/v1";
const headers = {
  "Content-Type": "application/json",
  "User-Agent": "Golem-v9",
  "X-Agent-Name": auth.agent_name,
  "Authorization": "Bearer " + auth.api_key
};

async function req(ep) {
  const r = await fetch(base + ep, { headers });
  if (r.status >= 400) {
    const e = await r.json().catch(() => ({}));
    return { error: r.status, detail: e };
  }
  return r.json();
}

async function main() {
  const dimensions = [
    { sub: "agents", label: "Agent Architecture" },
    { sub: "memory", label: "Memory Systems" },
    { sub: "builds", label: "Build Logs" },
    { sub: "tooling", label: "Tooling" },
    { sub: "infrastructure", label: "Infrastructure" },
    { sub: "todayilearned", label: "TIL" },
    { sub: "ai", label: "AI Research" },
    { sub: "security", label: "Security" },
  ];

  const insights = [];

  for (const dim of dimensions) {
    console.log(`\n=== ${dim.label.toUpperCase()} (m/${dim.sub}) ===`);
    const feed = await req(`/submolts/${dim.sub}/feed?limit=5&sort=hot`);
    const posts = feed.data || [];

    if (posts.length === 0) {
      console.log("  (empty)");
      continue;
    }

    for (const p of posts.slice(0, 3)) {
      const title = (p.title || "").substring(0, 80);
      const content = (p.content || "").substring(0, 400);
      const votes = p.upvotes || 0;
      console.log(`  🔥 [↑${votes}] @${p.author_id}`);
      console.log(`  Title: ${title}`);
      console.log(`  ${content}`);
      console.log("  ---");

      // Extract insights from high-voted posts
      if (votes >= 3 && content.length > 50) {
        insights.push({
          dimension: dim.label,
          title: title,
          author: p.author_id,
          votes: votes,
          key_content: content.substring(0, 200),
        });
      }
    }
  }

  // Search for specific topics relevant to our upgrade
  const searches = ["circuit breaker pattern", "grammY telegram", "XML config hot reload", "health endpoint monitoring"];

  for (const q of searches) {
    console.log(`\n=== SEARCH: "${q}" ===`);
    const results = await req(`/search?q=${encodeURIComponent(q)}&limit=3`);
    for (const r of (results.results || []).slice(0, 3)) {
      console.log(`  🔍 [${r.type}] ${(r.title || "").substring(0, 60)}`);
    }
  }

  // Summary
  console.log(`\n=== LEARNING SUMMARY ===`);
  console.log(`Dimensions explored: ${dimensions.length}`);
  console.log(`High-value insights collected: ${insights.length}`);
  for (const i of insights) {
    console.log(`  📌 [${i.dimension}] ${i.title} (↑${i.votes})`);
  }
}

main().catch(e => console.error("ERROR:", e.message));
