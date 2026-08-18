# GrokBot

Self-hosted AI agent teammates, modeled on xAI's Grok Bot — but **every agent gets its own
isolated operating system**, and it works with **any major AI provider**, running entirely on
your own machine (built for an Apple Silicon Mac mini).

- **Agents with real computers** — each agent owns a persistent Linux desktop (Docker container)
  with a browser, terminal, and files. It operates it like a human: moving the mouse, clicking,
  typing, and reading the screen.
- **iMessage-style chat** — agents are teammates in a sidebar. Give them a name, a job, and
  standing instructions; message them tasks.
- **Watch them work** — the "Agent computer" panel shows the live desktop (noVNC) with a running
  feed of every click, keystroke, and command.
- **Agents talk to each other** — direct messages and group chats with @mentions; delegation and
  handoffs happen on their own computers, with hard turn budgets so they can't loop forever.
- **Approvals** — consequential actions (deleting, sending, purchasing, `rm -rf`, force-pushes…)
  stop and ask you first, showing the exact pending command. Passwords/2FA use **Take over**:
  you drive the agent's screen directly while the agent pauses.
- **Memory** — agents keep durable preferences, facts, and task summaries per agent.
- **Multi-model** — pick a provider per agent:

| Provider | Computer-use path | Default model |
|---|---|---|
| Anthropic (Claude) | Messages API `computer` tool | `claude-sonnet-4-5` |
| OpenAI | Responses API `computer_use_preview` | `computer-use-preview` |
| Google (Gemini) | Interactions API `computer_use` (desktop env) | `gemini-3.6-flash` |
| Generic / xAI | Any OpenAI-compatible vision endpoint via a JSON action protocol | `grok-4` |

## Quickstart (Mac mini / Apple Silicon)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or [OrbStack](https://orbstack.dev)) and [Node.js ≥ 20](https://nodejs.org).
2. Clone this repo, then:

```bash
bash scripts/setup.sh     # checks Docker, installs deps, builds the agent OS image, creates .env
# add at least one API key to .env (ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY / XAI_API_KEY)
npm run dev
```

3. Open **http://localhost:5173**, hit **+ → New agent**, give it a name and a job, and message it.

Health check anytime: `node scripts/doctor.mjs`

### Try it without an API key

Create an agent and set its **model** to `mock-scripted` — a deterministic test model that
understands simple directives (`run: <cmd>`, `open the browser to <url>`,
`tell @Agent: <msg>`, `ask approval to <thing>`, `remember: <note>`). It exercises the whole
pipeline (real containers, real clicks) with no LLM calls.

## How it works

```
Browser UI (React, iMessage-style)
   │  REST + WebSocket
Node server (Fastify + SQLite)
   ├── Orchestrator: routes messages → per-agent serial task queues (parallel across agents)
   ├── Runner: screenshot → model action → execute → repeat  (per-provider adapters)
   ├── Safety: rule engine + provider safety flags → approval cards; takeover pause
   └── ComputerManager (dockerode)
          │ one container per agent
   ┌──────┴───────────────────────────────┐
   │ agentos-<id>  (grokbot/agent-desktop)│   Debian + Xvfb + openbox + tint2
   │  actuator API :8090 (xdotool/scrot)  │   Chromium, xterm, pcmanfm, mousepad
   │  noVNC :6080  (live view/takeover)   │   volume: /home/agent persists
   └──────────────────────────────────────┘
```

- Ports bind to **127.0.0.1 only** (host and containers) — nothing is exposed to your network.
- Agents run as a **non-root user** inside their container with memory/CPU limits
  (`COMPUTER_MEMORY`, default 2g / 2 CPUs) and `no-new-privileges`.
- Idle computers auto-stop after `COMPUTER_IDLE_STOP_MINUTES` (default 30); files, logins, and
  browser sessions survive in the agent's volume. `MAX_RUNNING_COMPUTERS` (default 4) caps
  concurrency — each agent OS uses roughly 1–2 GB RAM.

## Configuration

Copy `.env.example` → `.env`. Notable settings:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` … `XAI_API_KEY` | — | provider credentials (set the ones you use) |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | any OpenAI-compatible endpoint for the generic provider |
| `MAX_RUNNING_COMPUTERS` | 4 | concurrent agent OS cap |
| `COMPUTER_IDLE_STOP_MINUTES` | 30 | auto-stop idle computers (0 = never) |
| `COMPUTER_RESOLUTION` | 1280x800 | desktop size per agent |
| `MAX_TASK_STEPS` | 60 | per-task action cap |
| `MAX_AGENT_TURNS` | 8 | agent↔agent turns per user request (loop prevention) |

## Development

```bash
npm run dev          # server (:8484) + web (:5173), hot reload
npm test             # unit tests (adapters, safety rules, orchestrator)
npm run typecheck    # all workspaces
npm run image:build  # rebuild the agent OS image
RUN_DOCKER_TESTS=1 npm run test:integration -w apps/server   # real-Docker container tests
```

Repo layout: `apps/server` (Fastify API + runtime), `apps/web` (React UI),
`packages/shared` (types + action schema), `images/agent-desktop` (the agent OS),
`scripts/` (setup, doctor).

## Differences from the real Grok Bot

| | Grok Bot | This project |
|---|---|---|
| Computers | one shared cloud VM per user (per-bot screens) | **one isolated OS per agent**, local |
| Models | Grok only | Anthropic / OpenAI / Gemini / any OpenAI-compatible |
| Hosting | xAI cloud | your machine |
| Connectors / teach-a-task / mobile apps | yes | intentionally out of scope |

## Security notes

Agents can browse the web and run commands inside their containers. Treat each agent's computer
as semi-trusted: don't paste secrets into chats, use Take over for passwords/2FA (they go straight
to the agent's screen, never through a model), and keep the approval rules on. The web UI binds to
localhost; do not port-forward it without adding authentication.
