# Forge

A Grok Bot–style agent workspace that runs **other AI models**, gives each Bot its **own OS**, and skips the plugin marketplace and screen recording.

This repository started as a discovery of how Grok Bot actually works, then a first implementation of that product shape.

## What we learned about Grok Bot

Grok Bot (SpaceXAI / xAI, early beta 11 August 2026) is a roster of named teammates. You message them. They finish work inside real apps on a **persistent cloud Linux VM**. Closing your laptop does not stop a turn.

The marketing line “Bots have their own computer” is easy to misread. Official docs are unambiguous:

- **One computer per user account**, not per Bot
- Bots share files, browser cookies, and CLI credentials
- Each Bot gets its **own screen** on that shared VM
- Screens are work surfaces, **not security boundaries**
- “Do not use separate Bots as a security boundary”

How they use software:

1. **Plugins / MCP** when a connector exists (preferred)
2. **Computer use** otherwise — screenshot the GUI, then mouse and keyboard

Other important product facts:

| Area | Grok Bot |
| --- | --- |
| Roles | Name, title, description. Description holds standing rules |
| Collaboration | Async Bot-to-Bot DMs + group chats (2–6), `@` / `@everyone` |
| Memory | Per-Bot preferences and summaries; computer state is shared |
| Skills / routines | Written playbooks; routines schedule them. Teach-a-task records up to 10 minutes of browser UI (no mic) |
| Approvals | Mostly prose + optional model-based Auto-review. Secrets use human takeover, not chat |
| Models | **No picker.** Fixed router with failover |
| Clients | macOS, Windows, iPhone. Computer is Linux. Linux/Android desktop apps were not at launch |

Full write-up with source links: [`docs/grok-bot-research.md`](docs/grok-bot-research.md).  
What we copy vs skip: [`docs/product-scope.md`](docs/product-scope.md).  
How Forge is built: [`docs/architecture.md`](docs/architecture.md).

## What Forge does differently

- **Model picker** — OpenAI, Anthropic, Google, xAI, OpenRouter, or any OpenAI-compatible endpoint. No key? Rehearsal mode still drives the OS so you can try the product.
- **One OS per Bot** — isolated home folder and desktop. Handoffs are explicit messages or files, not inherited cookies.
- **No plugin marketplace** and **no screen recording**. Skills are written playbooks.
- **Hard-stop approvals** for send / publish / purchase / delete / production-looking actions.
- **Audit log** from day one. Live desktop is a view, not a capture.

## Run it

```bash
pnpm --dir apps/web install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). You get three seeded teammates: **Atlas** (chief of staff), **Scout** (research), **Piper** (writing). Try:

- “Open https://example.com and summarize the page”
- “Write a draft to notes.md”
- “Ask @Scout to gather sources” (turn Collaboration on, or use a group)
- “Send this email now” — should stop for approval

Add provider keys under **Models & keys**, then edit a Bot’s provider/model.

## Status

v1 is the control plane + isolated software OS (Files, Browser, Terminal, visible cursor). A Linux desktop image for a later Docker adapter lives in `runtime/linux-desktop/`.
