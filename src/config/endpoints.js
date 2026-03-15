// src/config/endpoints.js
// Unified URL configuration center — all external URLs from env, empty = skip
const AGENT_ID = process.env.GOLEM_AGENT_ID || 'golem';

const RAG_URL = process.env.RAG_URL || process.env.YEDAN_RAG_URL || '';
const WARROOM_URL = process.env.WARROOM_URL || '';
const WARROOM_AUTH_TOKEN = process.env.WARROOM_AUTH_TOKEN || '';

const WORKERS = {
    health: process.env.WORKER_HEALTH_URL || '',
    intel: process.env.WORKER_INTEL_URL || '',
    orchestrator: process.env.WORKER_ORCHESTRATOR_URL || '',
    content: process.env.WORKER_CONTENT_URL || '',
    revenue: process.env.WORKER_REVENUE_URL || '',
    rag: process.env.WORKER_RAG_URL || RAG_URL,
};

// MCP server URLs (9 workers)
const MCP_SERVERS = {
    'graph-rag': { url: WORKERS.rag, desc: 'Knowledge graph RAG queries & evolution' },
    'health-commander': { url: WORKERS.health, desc: 'System health monitoring & auto-healing' },
    'intel-ops': { url: WORKERS.intel, desc: 'Market intelligence & trend analysis' },
    'orchestrator': { url: WORKERS.orchestrator, desc: 'Task orchestration & fleet coordination' },
    'content-engine': { url: WORKERS.content, desc: 'Content generation & publishing' },
    'revenue-sentinel': { url: WORKERS.revenue, desc: 'Revenue tracking & anomaly detection' },
    'analytics-dashboard': { url: process.env.WORKER_ANALYTICS_URL || '', desc: 'API call analytics & usage stats' },
    'auto-agent-worker': { url: process.env.WORKER_AUTO_AGENT_URL || '', desc: 'Autonomous agent task execution' },
    'notion-warroom': { url: WARROOM_URL, desc: 'Notion war room sync & reporting' },
};

// Additional sandbox domains from env
const EXTRA_SANDBOX_DOMAINS = (process.env.SANDBOX_EXTRA_DOMAINS || '')
    .split(',').map(d => d.trim()).filter(Boolean);

module.exports = {
    AGENT_ID,
    RAG_URL,
    WARROOM_URL,
    WARROOM_AUTH_TOKEN,
    WORKERS,
    MCP_SERVERS,
    EXTRA_SANDBOX_DOMAINS,
};
