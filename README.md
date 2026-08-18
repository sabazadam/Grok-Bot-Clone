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
- **Stealth browsing** (per-agent, on by default) — the agent's browser is hardened against
  fingerprinting: realistic user-agent/timezone/locale, a bundled extension that spoofs the WebGL
  vendor/renderer (masking the software renderer), adds canvas/audio noise, and hides automation
  signals. Because agents drive a *real* desktop via OS-level input (not WebDriver/CDP),
  `navigator.webdriver` is already absent and there's no headless UA — this closes the remaining
  VM/fingerprint tells. Toggle it per agent; it applies live (no restart).
- **Grok Bot–style UI** — light iMessage look by default with a one-click dark theme, color-coded
  agents, duplicate / hide-from-sidebar, and a friendly onboarding state.
- **Native macOS desktop app** (Electron) — run the server locally or connect to your Mac mini as a
  "commander"; see [Desktop app](#desktop-app-macos).
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

3. Open the URL setup prints, hit **+ → New agent**, give it a name and a job, and message it.

`scripts/setup.sh` asks **how you'll use GrokBot** (see below). Health check anytime: `node scripts/doctor.mjs`

## Running it: single device vs. server + commander

Setup asks which fits you (re-run it anytime to switch):

1. **This device only** — the server and UI run on one machine; everything binds to `localhost`.
   Open `http://localhost:5173`.
2. **Server + commander (Tailscale)** — the Mac mini is the always-on **server** (runs the agents
   and their computers); you drive it from another device like a **MacBook** ("commander").
   Setup detects the Mac mini's **Tailscale IP** and binds the web UI and the live-desktop (noVNC)
   ports to it, so GrokBot is reachable only on your private tailnet. On the MacBook (joined to the
   same tailnet) open `http://<mac-mini-tailscale-ip>:5173`.

Only the web UI and the per-agent noVNC ports are ever exposed — the API and the in-container
actuator always stay on loopback and are reached through the Vite proxy on the server. If Tailscale
isn't detected, server mode falls back to binding all interfaces (`0.0.0.0`) with a warning; prefer
Tailscale (or a firewall) so the machine isn't open to your whole LAN/the internet.

Relevant `.env` keys (written by setup): `ACCESS_MODE`, `WEB_HOST`, `WEB_PORT`, `COMPUTER_BIND_HOST`.

## Desktop app (macOS)

Prefer a real app over a browser tab? Build the native macOS desktop app (Electron):

```bash
npm run app:dist        # builds the UI + Electron app → apps/desktop/release/GrokBot-*.dmg
```

Open the `.dmg` and drag **GrokBot** to Applications. On first launch it asks how to run:

- **Run on this device** — GrokBot launches its server locally (needs Docker + Node) and shows the UI.
  Point it at your GrokBot install folder (the one containing `apps/server`); the server runs from
  there with your system Node, reusing your dependencies and the built agent image.
- **Connect to a server (commander)** — the app is just the window; give it your server's URL,
  e.g. `http://<mac-mini-tailscale-ip>:8484`. This is the MacBook-drives-the-Mac-mini setup.

Change the choice anytime from **GrokBot → Settings…** (⌘,). To just develop/run it unpackaged:
`npm run app:dev`.

### Signing / "app is damaged" note
The default build is **unsigned** (no Apple Developer account needed). macOS Gatekeeper will warn on
first open — right-click the app → **Open**, or clear the quarantine flag:
`xattr -dr com.apple.quarantine /Applications/GrokBot.app`. To ship a signed + notarized build, add
your Developer ID identity and notarization credentials to `apps/desktop/electron-builder.yml`.

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
| `BROWSER_USER_AGENT` | current desktop Chrome UA | UA presented by stealth browsing |
| `BROWSER_TIMEZONE` | `America/New_York` | timezone the stealth browser reports |
| `BROWSER_LOCALE` | `en-US` | locale the stealth browser reports |

## Development

```bash
npm run dev          # server (:8484) + web (:5173), hot reload
npm test             # unit tests (adapters, safety rules, orchestrator)
npm run typecheck    # all workspaces
npm run image:build  # rebuild the agent OS image
RUN_DOCKER_TESTS=1 npm run test:integration -w apps/server   # real-Docker container tests
```

Repo layout: `apps/server` (Fastify API + runtime), `apps/web` (React UI),
`apps/desktop` (Electron macOS app), `packages/shared` (types + action schema),
`images/agent-desktop` (the agent OS), `scripts/` (setup, doctor).

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
to the agent's screen, never through a model), and keep the approval rules on.

In **single-device** mode everything binds to localhost. In **server + commander** mode the web UI
and noVNC ports become reachable from other devices — do this only over a private network like
**Tailscale** (which authenticates devices and encrypts traffic). GrokBot itself has no built-in
login, so never bind it to a public interface or port-forward it to the internet without putting
authentication (e.g. a reverse proxy, or Tailscale ACLs) in front of it.
