# Forge architecture

## 1. Picture

```
┌─────────────────────────────────────────────────────────────┐
│  Web app (Next.js)                                          │
│  Roster · Chat · Group · Approvals · Live desktop           │
└───────────────┬─────────────────────────────┬───────────────┘
                │ HTTP / SSE                  │ screenshot + input
┌───────────────▼───────────────┐   ┌─────────▼──────────────┐
│  Control plane                │   │  Computer fabric       │
│  bots · threads · memory      │   │  one workstation / Bot │
│  skills · approvals · audit   │   │  display · FS · shell  │
│  model router                 │   │  browser · input API   │
└───────────────┬───────────────┘   └─────────┬──────────────┘
                │                             │
                ▼                             ▼
         Provider SDKs                 Playwright / later
         (OpenAI-compatible,           Linux+noVNC container
          Anthropic, Google, xAI)
```

One process (the Next.js app) is the control plane and the default workstation host. Each Bot gets an isolated workstation directory and an in-process desktop session. A later adapter can swap that session for a Docker Linux desktop without changing the Bot/chat APIs.

## 2. Core objects

- **Bot** — name, title (role), description (standing rules), model, color, memory, workstation id
- **Thread** — `dm` (user ↔ one Bot) or `group` (user + 2–6 Bots)
- **Message** — user | bot | system | handoff | tool | approval | computer
- **Skill** — markdown playbook, optional Bot allow-list
- **Approval** — pending action + payload + status
- **Memory** — durable notes attached to one Bot
- **AuditEvent** — who, what, when, workstation, thread
- **Workstation** — isolated home dir, display size, cursor, open windows, browser tabs

Bots do **not** share cookies or OS state. They share only:

- messages you can see
- files they explicitly attach or write into `shared/`
- skills you enable

## 3. Model router

Every Bot stores `provider` + `model`. The router is a thin adapter:

| Provider | Protocol |
| --- | --- |
| `openai` | Chat Completions / Responses |
| `anthropic` | Messages API |
| `google` | Gemini generateContent |
| `xai` | OpenAI-compatible (`api.x.ai`) |
| `openrouter` | OpenAI-compatible |
| `custom` | Any OpenAI-compatible base URL |

The agent loop is provider-agnostic: same tools, same system prompt assembly (role + memories + skills + open approvals).

If no API key is configured, the loop still runs against a **local rehearsal model** so the UI and computer can be demonstrated.

## 4. Agent loop

```
user message
  → assemble context (role, memory, recent thread, skills, desktop caption)
  → model chooses text and/or tools
  → tools run (computer, files, shell, message_bot, request_approval)
  → risky tools park as Approval (status=pending)
  → computer tools mutate that Bot's workstation and emit audit + live frames
  → stream transcript events to the web client
  → persist messages + optional memory extract
```

Inter-bot talk is a tool: `message_bot`. It is only offered when the user has allowed collaboration on that thread or sent an explicit "talk to X" request. The receiving Bot gets a new turn on its own workstation.

## 5. Computer use

Each workstation exposes:

- `screenshot()` — PNG of the current desktop
- `mouse_move(x, y)` · `click(button)` · `scroll(dx, dy)`
- `type(text)` · `key(name)`
- `open_app(files|browser|terminal)`
- `fs.*` and `shell.run` as first-class tools (faster than clicking when appropriate)

The live view is a frame stream, not a recording. Frames are ephemeral. Nothing is written to a teach-task video.

v1 desktop is a **software framebuffer**: wallpaper, taskbar, windows (Files, Browser, Terminal), a visible cursor. The Browser window uses a fetch/readability path first; Playwright can replace it when browsers are installed. v2 adapter: XFCE + noVNC Linux container, same tool names.

## 6. Approvals

Hard-stop categories (cannot be overridden by the model):

- outbound send (email, post, message)
- purchase / payment
- delete / overwrite outside the Bot home
- publish
- production-looking hostnames

The UI shows Allow once / Deny. There is no "always allow everything in the browser."

## 7. Storage

SQLite via `better-sqlite3` at `data/forge.db`. Workstation files at `data/workstations/<botId>/`. Shared drop box at `data/shared/`.

This keeps v1 local-first and easy to run with `pnpm dev`.
