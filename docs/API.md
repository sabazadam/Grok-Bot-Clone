# Botbox API contract

Orchestrator base URL: `http://localhost:4400`. All REST endpoints are under `/api`
and speak JSON. The Vite dev server proxies `/api` and `/ws` to :4400.

## Types

```ts
type AgentStatus = 'idle' | 'working' | 'needs_attention';
type ComputerState = 'starting' | 'running' | 'stopped' | 'error';

interface Agent {
  id: string;              // e.g. "agt_a1b2c3"
  name: string;            // "Piper"
  title: string;           // "Product performance"
  description: string;     // role prompt / standing rules
  provider: string;        // 'anthropic' | 'openai' | 'xai' | 'openrouter' | 'ollama' | 'custom' | 'mock'
  model: string;           // e.g. "claude-sonnet-4-5"
  color: string;           // avatar hex color, e.g. "#7c5cff"
  status: AgentStatus;
  computerState: ComputerState;
  memory: string;          // agent's persistent notes (read-only in UI)
  createdAt: string;       // ISO
}

type MessageRole =
  | 'user'        // human -> agent
  | 'assistant'   // agent -> human (final answers, questions)
  | 'peer_in'     // another agent -> this agent   (senderAgentId/senderName set)
  | 'peer_out'    // this agent -> another agent   (recipient in meta.toName)
  | 'activity'    // tool step, content is JSON (see below)
  | 'system';     // lifecycle notices ("computer started", errors)

interface Message {
  id: string;
  agentId: string;         // owning thread
  role: MessageRole;
  content: string;         // for 'activity': JSON string of Activity
  senderAgentId?: string;
  senderName?: string;
  meta?: Record<string, unknown>; // e.g. { toName: "Scout" } on peer_out
  createdAt: string;
}

// content of role === 'activity' messages, JSON-encoded:
interface Activity {
  kind: 'screenshot' | 'click' | 'double_click' | 'right_click' | 'move'
      | 'scroll' | 'type' | 'key' | 'wait' | 'exec' | 'remember' | 'thought';
  summary: string;         // human-readable, e.g. `clicked at (412, 230)`
  detail?: string;         // e.g. command output excerpt
}

interface ProviderInfo {
  id: string;              // 'anthropic' | ...
  label: string;           // 'Anthropic (Claude)'
  models: string[];        // suggested models; UI must also allow free text
  hasKey: boolean;         // a key is configured (env or settings)
  needsKey: boolean;       // false for ollama/custom/mock
  needsBaseUrl: boolean;   // true for ollama/custom
}
```

## REST endpoints

| Method & path | Body | Returns | Notes |
| --- | --- | --- | --- |
| `GET /api/agents` | — | `Agent[]` | roster |
| `POST /api/agents` | `{name, title, description, provider, model, color}` | `Agent` | boots container async; watch `computerState` via WS |
| `GET /api/agents/:id` | — | `Agent` | |
| `PATCH /api/agents/:id` | any subset of `{name, title, description, provider, model, color}` | `Agent` | |
| `DELETE /api/agents/:id` | — | `{ok: true}` | stops & removes container + volume |
| `GET /api/agents/:id/messages?limit=100` | — | `Message[]` | ascending by time |
| `POST /api/agents/:id/messages` | `{content: string}` | `{ok: true}` | queues a run; replies stream via WS |
| `POST /api/agents/:id/stop` | — | `{ok: true}` | interrupt current run |
| `POST /api/agents/:id/computer/restart` | — | `{ok: true}` | recreate container (files on volume survive) |
| `GET /api/agents/:id/screenshot` | — | `image/png` | latest frame; 404 until computer runs |
| `GET /api/providers` | — | `ProviderInfo[]` | |
| `GET /api/settings` | — | `{keys: Record<string,{set: boolean}>, baseUrls: Record<string,string>}` | never returns key values |
| `PUT /api/settings` | `{keys?: Record<string,string>, baseUrls?: Record<string,string>}` | same as GET | empty-string key deletes |

Errors: non-2xx with `{error: string}`.

## WebSocket `/ws` (events, JSON)

Server → client only; no client messages needed.

```ts
type WsEvent =
  | { type: 'hello'; agents: Agent[] }                       // sent on connect
  | { type: 'agent_created'; agent: Agent }
  | { type: 'agent_updated'; agent: Agent }                  // any field incl. status/computerState
  | { type: 'agent_deleted'; agentId: string }
  | { type: 'message'; message: Message };                   // append to that agent's thread
```

## WebSocket `/api/agents/:id/vnc` (binary)

Raw RFB (VNC) byte stream proxied to the agent's display — connect noVNC's `RFB`
class directly to this URL. View-only watching = construct with
`rfb.viewOnly = true`; takeover = set `viewOnly = false`. No VNC password.
The socket closes if the computer is not running.

## Frontend expectations (v0.1)

- Left sidebar: agent roster with avatar (initial letter on `color`), name, title,
  status dot (grey idle / pulsing accent working / amber needs_attention),
  computer state badge if not `running`. "New agent" button.
- Center: chat thread for the selected agent. Render roles distinctly:
  user (right-aligned), assistant, peer_in/peer_out (labeled "from/to <name>"),
  system (muted), activity (compact monospace step lines, collapsible run groups
  are a bonus). Composer with Enter-to-send; "Stop" button while status=working.
- Right: computer panel (collapsible). noVNC canvas, Watch/Take control toggle,
  Restart computer button, connection state overlay.
- Modals: New agent (name, title, description textarea, provider select from
  `GET /api/providers` with model suggestions + free text, color picker);
  Settings (per-provider API key inputs, base URLs where `needsBaseUrl`).
- Dark, modern, product-quality UI. No component library required.
