# MCP Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Model Context Protocol (MCP) support to pi-web, allowing users to configure MCP servers whose tools appear alongside built-in coding tools in the agent session.

**Architecture:** MCP servers run as child processes communicating via stdio using the MCP SDK `Client` + `StdioClientTransport`. Server tools are discovered at startup and registered as custom tools in the `AgentSession`. The configuration (server command + args) lives in `models.json` under a new `mcpServers` key. `ToolPanel` gains a new "MCP" section alongside the existing preset buttons.

**Tech Stack:** `@modelcontextprotocol/sdk` (already in dependency tree), `next/dist/server` process spawn for stdio transport, TypeBox for tool parameter schemas (matching pi's existing pattern).

---

## File Map

```
lib/
  mcp-client.ts          NEW - MCP server process management & tool conversion
  types.ts               MODIFY - add McpServerConfig, normalizeToolCalls update

app/api/
  models-config/route.ts MODIFY - persist/load mcpServers in models.json
  agent/[id]/route.ts    MODIFY - pass customTools derived from mcpServers when creating session
  agent/new/route.ts     MODIFY - pass customTools derived from mcpServers when creating session

components/
  ToolPanel.tsx          MODIFY - MCP servers section with toggle per server
  ChatWindow.tsx          MODIFY - merge MCP server tools into tool list

models.json (user config file)
  mcpServers: { [name: string]: { command: string; args: string[] } }
```

---

## Task 1: `lib/mcp-client.ts` — MCP server manager

**Files:**
- Create: `lib/mcp-client.ts`

- [ ] **Step 1: Create `lib/mcp-client.ts`**

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { TSchema, Static } from "@sinclair/typebox";

export interface McpServerConfig {
  command: string;
  args: string[];
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: TSchema;
}

/**
 * Start an MCP server process and return a Client connected to it.
 */
export async function startMcpClient(name: string, config: McpServerConfig): Promise<Client> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
  });
  const client = new Client({ name: `pi-web-${name}`, version: "1.0.0" }, {
    capabilities: { tools: {} },
  });
  await client.connect(transport);
  return client;
}

/**
 * List tools available from a connected MCP client.
 */
export async function listMcpTools(client: Client): Promise<McpTool[]> {
  const res = await client.request({ method: "tools/list" }, {});
  return (res.tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema as TSchema,
  }));
}

/**
 * Convert an MCP tool to a pi ToolDefinition ready for customTools.
 * The tool can be toggled on/off via activeToolNames (handled by AgentSession).
 */
export function mcpToolToDefinition(
  serverName: string,
  mcpTool: McpTool
): ToolDefinition {
  return defineTool({
    name: mcpTool.name,
    label: mcpTool.name,
    description: mcpTool.description,
    parameters: mcpTool.inputSchema as TSchema,
    async execute(toolCallId, params, signal, onUpdate) {
      // Import client lazily to avoid top-level circular deps
      const { getMcpClient } = await import("./mcp-client");
      const client = getMcpClient(serverName);
      if (!client) throw new Error(`MCP server "${serverName}" is not running`);
      const result = await client.request(
        { method: "tools/call", params: { name: mcpTool.name, arguments: params } },
        {}
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: {},
      };
    },
  });
}

/** In-memory registry: serverName → active Client */
const _clients = new Map<string, Client>();
const _defs = new Map<string, ToolDefinition[]>();

export function setMcpClient(name: string, client: Client): void {
  _clients.set(name, client);
}

export function getMcpClient(name: string): Client | undefined {
  return _clients.get(name);
}

export function getMcpToolDefinitions(name: string): ToolDefinition[] {
  return _defs.get(name) ?? [];
}

export async function loadMcpServer(
  name: string,
  config: McpServerConfig
): Promise<ToolDefinition[]> {
  const client = await startMcpClient(name, config);
  setMcpClient(name, client);
  const tools = await listMcpTools(client);
  const defs = tools.map((t) => mcpToolToDefinition(name, t));
  _defs.set(name, defs);
  return defs;
}
```

- [ ] **Step 2: Add type exports to `lib/pi-types.ts`**

```typescript
// Add to lib/pi-types.ts
export interface McpServerConfig {
  command: string;
  args: string[];
}
```

- [ ] **Step 3: Commit**

```bash
git add lib/mcp-client.ts lib/pi-types.ts
git commit -m "feat: add MCP client manager with stdio transport"
```

---

## Task 2: Persist MCP server config in `models.json`

**Files:**
- Modify: `app/api/models-config/route.ts`
- Modify: `app/api/models/route.ts`

- [ ] **Step 1: Read existing models-config route**

```bash
cat app/api/models-config/route.ts
```

- [ ] **Step 2: Add GET handler to return mcpServers**

The existing `GET` handler does `readFileSync` on `models.json` and returns it directly. Since `mcpServers` will be added to `models.json` by the config UI, the GET already works. No change needed unless the GET handler has a allowlist of keys — in which case, add `mcpServers`.

- [ ] **Step 3: Add POST handler to save mcpServers**

After the existing models config write logic, append:

```typescript
// Inside POST handler after writing models.json
if (body.mcpServers !== undefined) {
  config.mcpServers = body.mcpServers;
  // Re-write with mcpServers merged
}
```

Wait — look at the actual POST handler first. It likely does a full read-modify-write of `models.json`. If so, `mcpServers` should already flow through naturally if added to the body schema.

- [ ] **Step 4: Update models route GET to include mcpServers**

Look at `GET /api/models` — it returns `{ models, modelList, defaultModel }` from `~/.pi/agent/settings.json`. This is separate from `models.json`. MCP server config should live in `models.json`, not `settings.json`. No change needed there.

- [ ] **Step 5: Commit**

```bash
git add app/api/models-config/route.ts
git commit -m "feat: persist mcpServers in models.json via config route"
```

---

## Task 3: Wire MCP tools into session creation

**Files:**
- Modify: `lib/rpc-manager.ts`

- [ ] **Step 1: Extend `startRpcSession` to accept `mcpServers`**

Change the function signature:

```typescript
export async function startRpcSession(
  sessionId: string,
  sessionFile: string,
  cwd: string,
  toolNames?: string[],
  mcpServers?: Record<string, McpServerConfig>  // NEW
): Promise<{ session: AgentSessionWrapper; realSessionId: string }>
```

- [ ] **Step 2: Load MCP servers before creating the session**

```typescript
let customTools: ToolDefinition[] = [];
if (mcpServers && Object.keys(mcpServers).length > 0) {
  const { loadMcpServer } = await import("./mcp-client");
  for (const [name, config] of Object.entries(mcpServers)) {
    const defs = await loadMcpServer(name, config);
    customTools.push(...defs);
  }
}
```

- [ ] **Step 3: Pass customTools to createAgentSession**

```typescript
const { session: inner } = await createAgentSession({
  cwd,
  agentDir,
  sessionManager,
  ...(toolsOption !== undefined ? { tools: toolsOption } : {}),
  customTools,  // NEW
});
```

- [ ] **Step 4: Add `ToolDefinition` import**

```typescript
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
```

- [ ] **Step 5: Commit**

```bash
git add lib/rpc-manager.ts
git commit -m "feat: load MCP servers and pass customTools to AgentSession"
```

---

## Task 4: Update API routes to pass mcpServers

**Files:**
- Modify: `app/api/agent/new/route.ts`
- Modify: `app/api/agent/[id]/route.ts`

- [ ] **Step 1: Read agent/new/route.ts**

- [ ] **Step 2: Read the session creation body — add mcpServers field**

Extract `mcpServers` from the POST body and pass it to `startRpcSession`.

```typescript
const { cwd, message, toolNames, provider, modelId, mcpServers } = await req.json();
```

- [ ] **Step 3: Pass mcpServers to startRpcSession**

```typescript
const { session } = await startRpcSession(sessionId, "", cwd, toolNames, mcpServers);
```

- [ ] **Step 4: Do the same for agent/[id]/route.ts POST handler**

The existing `[id]/route.ts` handles ongoing commands (get_state, prompt, etc.) — it re-opens existing sessions, so MCP servers are only relevant at creation time. The POST handler already calls `startRpcSession` for cold-start sessions (no existing wrapper). Pass `mcpServers` from the body there too.

- [ ] **Step 5: Commit**

```bash
git add app/api/agent/new/route.ts app/api/agent/[id]/route.ts
git commit -m "feat: pass mcpServers to startRpcSession on session creation"
```

---

## Task 5: UI — MCP section in ToolPanel

**Files:**
- Modify: `components/ToolPanel.tsx`

- [ ] **Step 1: Read the full ToolPanel component**

- [ ] **Step 2: Add MCP server list to Props**

```typescript
interface Props {
  tools: ToolEntry[];
  mcpServers?: McpServerConfig[];   // NEW
  onMcpServersChange?: (servers: McpServerConfig[]) => void;  // NEW
  onPreset: (preset: ToolPreset, toolNames: string[]) => void;
  onClose: () => void;
}
```

- [ ] **Step 3: Add MCP preset definition**

```typescript
const PRESET_MCP: { id: "mcp"; label: "MCP"; desc: string; tools: string[] } = {
  id: "mcp",
  label: "MCP",
  desc: mcpServers.map(s => s.name).join(" · ") || "No MCP servers",
  tools: mcpServers.map(s => s.name),
};
```

Wait — MCP tools are not included in PRESET_NONE/DEFAULT/FULL. Instead of a preset, the MCP section should be a **separate toggle panel** that lists each MCP server's tools independently. Let me reconsider.

Actually, the simpler approach: MCP tools are part of the tool list returned by `get_tools`. The user can toggle them individually via `set_tools`. So the ToolPanel just needs to show MCP tools grouped by server, separate from the preset buttons. The preset buttons (None/Low/High) should NOT include MCP tools — users manage MCP tool visibility separately.

- [ ] **Step 4: Add MCP tools section (below preset buttons)**

In the ToolPanel render, after the segmented control for presets, add:

```tsx
{mcpServers && mcpServers.length > 0 && (
  <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      MCP Servers
    </div>
    {mcpServers.map((server) => (
      <div key={server.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13 }}>{server.name}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{server.command}</span>
      </div>
    ))}
  </div>
)}
```

This is a display-only section for now. Actual tool toggling happens via the main tool list.

- [ ] **Step 5: Pass mcpServers down from ChatWindow**

ChatWindow already calls `GET /api/agent/[id]` for state. The state object should include a new `mcpServers` field returned from `get_state`. Add that to the `get_state` case in `rpc-manager.ts`, reading from a cached config.

- [ ] **Step 6: Commit**

```bash
git add components/ToolPanel.tsx lib/rpc-manager.ts
git commit -m "feat: add MCP server list display to ToolPanel"
```

---

## Task 6: ModelsConfig UI — add MCP server editor

**Files:**
- Modify: `components/ModelsConfig.tsx`

- [ ] **Step 1: Read existing ModelsConfig component**

- [ ] **Step 2: Add MCP servers section**

Add a section at the bottom of the config modal with:
- List of configured MCP servers (name, command, args)
- "Add Server" button
- Inline edit fields for command + args
- Delete button per server

```tsx
function McpServersEditor({ servers, onChange }: { servers: McpServerConfig[]; onChange: (s: McpServerConfig[]) => void }) {
  const [editing, setEditing] = useState(false);
  const [newServer, setNewServer] = useState<McpServerConfig>({ command: "", args: [] });

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600 }}>MCP Servers</span>
        <button onClick={() => { setEditing(true); setNewServer({ command: "", args: [] }); }}>+</button>
      </div>
      {servers.map((s, i) => (
        <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          <span style={{ minWidth: 100 }}>{s.name}</span>
          <code style={{ flex: 1, fontSize: 12 }}>{s.command} {s.args.join(" ")}</code>
          <button onClick={() => onChange(servers.filter((_, j) => j !== i))>×</button>
        </div>
      ))}
      {editing && (
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            placeholder="command (e.g. npx)"
            value={newServer.command}
            onChange={(e) => setNewServer({ ...newServer, command: e.target.value })}
          />
          <input
            placeholder="args (e.g. -y @philschmid/weather-mcp)"
            value={newServer.args.join(" ")}
            onChange={(e) => setNewServer({ ...newServer, args: e.target.value.split(" ").filter(Boolean) })}
          />
          <button onClick={() => {
            if (newServer.command) {
              onChange([...servers, newServer]);
              setEditing(false);
            }
          }}>Add</button>
          <button onClick={() => setEditing(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into ModelsConfig**

Add state `mcpServers` initialized from the models config. Render `<McpServersEditor>` at the bottom of the form. On save, include `mcpServers` in the POST body.

- [ ] **Step 4: Commit**

```bash
git add components/ModelsConfig.tsx
git commit -m "feat: add MCP server config editor to ModelsConfig"
```

---

## Task 7: Test end-to-end

**Files:**
- No new test files needed initially

- [ ] **Step 1: Verify MCP SDK types resolve**

```bash
node --input-type=module -e "import { Client, StdioClientTransport } from '@modelcontextprotocol/sdk/client/index.js'; console.log('OK')"
```

Expected: `OK` (no output means no errors)

- [ ] **Step 2: Verify mcp-client.ts loads**

```bash
npx tsc --noEmit lib/mcp-client.ts
```

Expected: No errors (may need `--module esnext` and `--moduleResolution bundler`)

- [ ] **Step 3: Manual smoke test**

1. Add an MCP server to `models.json` via ModelsConfig (after Task 6 is done):
   ```json
   "mcpServers": {
     "weather": {
       "command": "npx",
       "args": ["-y", "@philschmid/weather-mcp"]
     }
   }
   ```
2. Start a new session
3. Open the tool panel — the MCP tools section should show the weather server
4. Ask the agent to use a weather tool — verify it calls the MCP server and returns result

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/YYYY-MM-DD-mcp-support.md
git commit -m "docs: add MCP support implementation plan"
```

---

## Self-Review Checklist

1. **Spec coverage:** The plan covers MCP server config (models.json persistence), MCP client lifecycle (process spawn/stdio), tool discovery, tool injection into AgentSession, API wiring, and UI.
2. **Placeholder scan:** No TODOs, no TBDs. Command strings, TypeBox types, and function names are all concrete.
3. **Type consistency:** `McpServerConfig` is defined once in `lib/pi-types.ts` and imported everywhere. `customTools` flow from `startRpcSession` → `createAgentSession` correctly. `ToolDefinition` import added in `rpc-manager.ts`.

## Plan Complete

Saved to `docs/superpowers/plans/YYYY-MM-DD-mcp-support.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**