# Product scope — Forge

**Forge** is the working name for this Grok Bot–style workspace. It is a multi-model agent roster. Each Bot gets its own operating system, a role you assign, and the ability to talk to other Bots when you ask.

## In scope (v1)

- Web control plane (desktop-first)
- Create / edit / hide / delete named Bots
- Role, standing rules, avatar, per-Bot model
- 1:1 chat with streaming transcript
- Group chat (2–6 Bots) with `@` routing
- On-request Bot-to-Bot messages (visible handoff)
- Per-Bot workstation OS (isolated filesystem + desktop + browser + terminal)
- Human-like computer use: screenshot, move mouse, click, type, keys
- Live desktop view (no recording, no teach-by-demo capture)
- Human takeover for passwords / 2FA / CAPTCHA
- Default-deny approvals for send / publish / delete / purchase / production
- Written skills (`/` invoke); "save what we just did" from the transcript
- Per-Bot memory (preferences + summaries)
- Action audit log
- Multi-model providers: OpenAI, Anthropic, Google, xAI, OpenRouter, any OpenAI-compatible endpoint
- Dry-run / sandbox flag on a workstation

## Out of scope (v1)

- Screen recording / "Teach a task"
- Plugin marketplace, MCP catalog, Slack / GitHub / Salesforce connectors
- Event-triggered automations from third-party apps
- Native macOS / Windows / iOS clients
- Commands on the user's local laptop
- Team SSO, org computer kill, spend caps
- Shared-cookie computer (Grok Bot's model)

## Later

- Scheduled routines
- Native clients
- Optional shared team drive (explicit, not ambient cookies)
- Optional MCP servers the user adds by URL
- Full Linux desktop image when Docker is available on the host
