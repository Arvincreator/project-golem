# MCP (Model Context Protocol) Usage and Development Guide

The Model Context Protocol (MCP) is an open standard that enables AI models to interact securely and seamlessly with local or remote tools and data sources.

In Project Golem, **Golem acts as the MCP Client**, while various tools (such as Hacker News scrapers or Chrome DevTools controllers) act as **MCP Servers**. This architecture provides Golem with infinite extensibility.

---

## 🚀 Quick Start: Using Hacker News MCP as an Example

This section will guide you through installing and integrating [hn-server](https://github.com/pskill9/hn-server) into Golem.

### 1. Compile the MCP Server locally
First, clone the MCP Server and build it:

```bash
# We recommend placing these in a 'vendors' folder within the project directory
git clone https://github.com/pskill9/hn-server
cd hn-server

# Install dependencies and build
npm install
npm run build
```

Once built, the core entry point is usually located at `build/index.js` or `dist/index.js`.

### 2. Add the Server in Web Dashboard
Open Golem's Web Dashboard and click on **"MCP Tools"** in the sidebar.

1. Click **"Add Server"**.
2. Fill in the following fields:
   - **Name**: `hacker-news` (Lowercase recommended; this is the ID used by the AI)
   - **Command**: `node`
   - **Arguments**: Enter the **absolute path** to the built file, for example:
     `["/Users/yourname/project-golem/hn-server/build/index.js"]`
   - **Description**: `Hacker News real-time data fetching tool`
3. Click **"Save"**.

### 3. Test Connection
Locate `hacker-news` in the server list and click the **"Test Connection"** icon (lightning bolt).
If it displays "Found X tools," Golem has successfully established a JSON-RPC connection with the server.

### 4. Interact with Golem
After restarting Golem, you can give it direct instructions:
> "Get me the top 5 stories from Hacker News"

Golem will automatically recognize the prompt and issue an Action like this:
```json
[ACTION]
{
  "action": "mcp_call",
  "server": "hacker-news",
  "tool": "get_stories",
  "parameters": {
    "type": "top",
    "limit": 5
  }
}
[/ACTION]
```

---

## 🛠️ Management Features

### MemPalace One-Click Enable (Auto Install + Verification)
When you enable the `mempalace` server in the Dashboard, Golem now runs a built-in setup flow:

1. Runs the installer script (`scripts/mcp/install-mempalace.js`) to create an isolated virtual environment at `data/mcp/mempalace-runtime/.venv` and install `mempalace` (skips if already installed).
2. Enables the MCP server and performs a `tools/list` connection test.
3. Executes a read-only probe tool call (for example `mempalace_search`) to verify runtime functionality.
4. If verification fails, Golem automatically disables `mempalace` to prevent a broken enabled state.

You can also run the installer manually:
```bash
npm run mcp:install:mempalace
```

### Live Logs
The log panel at the bottom of the MCP page displays real-time details:
- Call timestamps and duration
- Sent parameters
- Raw server responses
- Error messages (if any)

### Tool Inspector
Clicking on a server in the list shows all available tools and their parameter definitions (JSON Schema). Golem's brain reads these definitions at startup to ensure accurate tool invocation.

---

## 💡 Best Practices

1. **Path Management**: Always use **absolute paths** for configuration. Node.js does not automatically expand `~` in subprocess commands.
2. **Lazy Loading**: Golem's MCP Manager uses lazy loading; server processes are started only when needed for a tool call or when viewed in the dashboard.
3. **Troubleshooting**: If the AI cannot find a tool, ensure the server is **Enabled** in the dashboard and that the connection test succeeds.

For more official MCP server examples, see: [Model Context Protocol GitHub](https://github.com/modelcontextprotocol/servers)
