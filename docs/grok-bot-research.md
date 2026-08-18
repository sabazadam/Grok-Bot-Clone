# Grok Bot discovery report

**Date:** 18 August 2026  
**Sources:** official SpaceXAI / xAI docs (`docs.x.ai/grok-bot/*`), the 11 August 2026 launch post, and launch-week reviews that cite those docs.  
**Purpose:** understand how Grok Bot actually works, list the features that matter, and decide what this clone should copy, change, or skip.

This is a product-and-architecture read of the public system. We do not have access to Grok Bot source code.

---

## 1. What Grok Bot is

Grok Bot is an always-on **agent roster**, not a chat window.

You create named teammates (Bots). You message them the way you would message a colleague. Each Bot has a job, a conversation, memory, and the ability to finish work inside real apps. Work runs on a **persistent cloud Linux VM**, so closing your laptop does not stop a turn or a scheduled routine.

The product launched in early beta on **11 August 2026** for SuperGrok Heavy, Cursor Ultra, and Cursor Teams Premium. Clients: macOS, Windows, iPhone (iOS 18+). Linux desktop and Android were not supported at launch. The **computer itself** is a managed Linux VM; the desktop app is only a remote control surface.

xAI's own framing (paraphrased from the overview):

> A Bot is a single persistent, named agent. You give it real work. It signs into apps and websites like a person. It coordinates with other Bots. It only comes back when something needs approval.

---

## 2. How it works (the real architecture)

### 2.1 One computer per user, not per Bot

This is the most important design fact, and it is easy to misread from the marketing line "Bots have their own computer."

| Claim in marketing | What the docs actually say |
| --- | --- |
| Each Bot has a computer | Each **user account** gets one managed Linux VM |
| Bots work independently | They share filesystem, browser cookies, and CLI credentials |
| Separate Bots are isolated | Screens are separate **work surfaces**, not security boundaries |

Official rule: **do not use separate Bots as a security boundary.**

Consequences:

- Signing into Gmail for the Expense Bot also signs in the Talent Scout Bot.
- Deleting a Bot does **not** wipe files or logins on the computer.
- Handoffs are cheap: Bot B can open the spreadsheet Bot A just saved in `/workspace`.
- Isolation is at the **member / account** level. In teams, each person gets one VM; org admins can kill that VM.

Each Bot gets **its own screen** on that shared VM so several Bots can click and type in parallel. One Bot can run only **one computer-use task** on its screen at a time.

The Bot process on the VM runs as a **non-root** user.

### 2.2 Two ways to use software

1. **Connectors / plugins / MCP** — structured tool calls. Preferred when a connector exists. Installed account-wide, not per Bot. Mentioned in chat with `@`.
2. **Computer use** — screenshot the GUI, then issue mouse moves, clicks, and keystrokes, the same way a human would. This is how it uses sites with no API.

xAI is explicit that computer use is broader and more brittle. Use a connector when you can.

### 2.3 The human stays in the loop for secrets

Passwords, passkeys, 2FA, CAPTCHAs, payments, and "this site requires a human" steps are **not** typed by the model. The Bot pauses, you open **Agent Computer**, take over, complete the step, and hand control back. A narrow "secure secret request" exists for supported connections: the value is masked, kept out of the transcript, and not shown to the model.

You can also **watch** the desktop live (clicks, typing, navigation, status) and leave the preview while work continues.

### 2.4 Local computer is a separate, dangerous capability

The cloud VM is not your Mac/Windows box. Local command execution is off unless enabled, default **Ask every time**, and every local action goes through Auto-review. Teams will get a ceiling of Never / Ask / Always.

### 2.5 Models are not user-selectable

Grok Bot has **no model picker** for members or admins. Each request routes to a fixed set of models for that surface, with automatic failover. Usage analytics show which model actually served the request. This is a hard product decision on their side.

### 2.6 Persistence model

Survives normal updates / recovery:

- `/workspace` files
- browser cookies / signed-in sessions
- supported sign-ins
- Bot profiles, conversations, skills, routines, memories

Treated as replaceable:

- temp directories
- manually installed packages
- uncommitted application state

Recovery ladder: Retry → Recover computer (keep durable state) → Update Agent Computer (rebuild image, keep durable state) → Reset (last snapshot, may lose recent work).

---

## 3. Important features (the ones that define the product)

Ranked by how much they matter if you want "the same kind of product."

### P0 — Without these it is not Grok Bot

| Feature | What it is | Why it matters |
| --- | --- | --- |
| **Named persistent Bots** | Name, title/job, description, avatar, own conversation | A Bot is a teammate with a durable role, not a disposable thread |
| **Role / job assignment** | Operational description of ownership, sources, style, and standing approval boundaries | Focused Bots accumulate useful context; a "General Helper" does not |
| **Persistent computer** | Always-on Linux VM with browser, filesystem (`/workspace`), terminal | Work finishes in real tools; laptop-closed work is possible |
| **Human-like computer use** | Screenshot → mouse / keyboard | Reaches software that has no API or MCP |
| **Live computer view + takeover** | Watch the screen; take control for passwords / 2FA / CAPTCHA | Trust and secret handling |
| **Background execution** | Turns and routines keep running when the client is closed | "Always-on coworker" vs chatbot |
| **Bot-to-Bot messaging** | Async DM: receiver wakes, works, replies later; visible in transcript | User is not the router between specialists |
| **Group chats** | 2–6 Bots, self-routing or `@mention` / `@everyone` | Shared outcome with visible handoffs |
| **Approvals** | Consequential actions pause for Allow once / Deny / Always allow | Sending, publishing, deleting, buying, production changes |
| **Memory** | Per-Bot preferences, role context, summaries | Role compounds across days |

### P1 — Makes it a real workplace, not a demo

| Feature | What it is |
| --- | --- |
| **Skills** | Reusable "how to do this" instructions: when to use, inputs, steps, validation, output, approval rules. Shared across Bots; `/` to invoke. |
| **Routines** | Bind a skill to one Bot + a schedule (or event). Up to 50 routines per Bot; last 20 run records kept. Test run does **real** work. |
| **Event triggers** | Slack / GitHub-style account integrations can start a routine (separate from plugins). |
| **@ mentions** | `@` Bot, group, routine, or connector; `/` skill |
| **Threads + reactions** | Thread for one result or approval; reactions are not safety decisions |
| **Attention states** | Needs attention (question / approval / handoff), unread result, working / typing |
| **Notifications** | OS / mobile when a Bot finishes or needs input |
| **File attachments + result cards** | Images, office docs, CSV/JSON, notebooks, video; preview / save / revise in place |
| **Action log in the transcript** | Tool use, computer use, files, questions, approvals inline |
| **Pin / hide / duplicate Bots** | Duplicate copies profile, skills, routines — not memory or history |
| **Limits** | 50 Bots + group chats combined; 6 attachments per desktop send |

### P2 — Platform and enterprise (important, not the core loop)

| Feature | Notes |
| --- | --- |
| **Plugins marketplace** | Connectors + packaged skills. Account-wide. Team MCP allow/deny lists. |
| **Auto-review** | Model-based gate on tool + computer actions. Require Approval beats Always Allow. Stored per desktop, synced to that computer. |
| **Teach a task** | Record up to **10 minutes** of **browser** interaction (no mic). Produces a **draft skill**. Gradual rollout. |
| **Cross-device sync** | Same Bots and threads on desktop and iPhone |
| **Search / command palette** | Jump across Bots, messages, files, routines |
| **Team admin** | Cursor SSO, privacy mode, MCP policy, team rules scoped to Cursor / Grok Bot / both, computer kill, setup scripts, egress IPs |
| **WebAuthn forwarding** | Hardware keys on the member's desk complete prompts inside the VM browser |
| **Local computer policy** | Separate from cloud computer |
| **Usage / billing** | Weekly included usage + on-demand tokens; no Grok Bot-specific spend cap at launch |

### Suggested first-party roles (from their use-case guide)

Sales Outbound, Talent Scout, Paid Media, Expense Manager, Product Performance, Bug Reproduction, Account Health, **Chief of Staff**. Pattern: one Bot owns an end-to-end outcome; a chief of staff sits on top and routes.

---

## 4. Features we will **not** clone in this version

Per the request: same product shape, but **multi-model**, **few third-party connections**, **no screen recording**.

| Grok Bot feature | Decision | Reason |
| --- | --- | --- |
| Plugin / MCP marketplace and Slack/GitHub/Salesforce-style connectors | **Skip for v1** | Explicitly out of scope; computer use + files + terminal cover "any app" |
| Teach a task / screen recording | **Skip** | Explicitly out of scope. Skills are written, or inferred from a completed text task |
| Event triggers from Slack / GitHub | **Skip for v1** | Third-party connection |
| Native macOS / Windows / iOS apps | **Defer** | Web app first; computer still runs remotely |
| Local-computer command execution | **Skip for v1** | High risk; cloud/workstation OS is enough |
| Fixed hidden model router | **Invert** | This clone **exposes** a model picker (Grok, Claude, GPT, Gemini, OpenRouter, local) |
| Shared one-VM-for-all-Bots | **Invert** | This clone gives each Bot its **own OS / workstation** (your requirement). Shared files become an explicit handoff, not an accident |
| Team SSO / Cursor account binding | **Defer** | Local-first auth or a simple user for v1 |

---

## 5. Design facts that should change our clone

1. **Isolation model.** Grok Bot optimized for cheap handoffs (shared logins). You asked for a unique OS per agent. We should isolate desktops and add an **explicit** shared folder or attachment handoff so Bots can still collaborate without inheriting every cookie.
2. **Model choice is a product feature here.** Grok Bot refuses a picker. Supporting Fable / Claude / GPT / Gemini / Grok / local models is the main commercial difference.
3. **Approvals are mostly prose in Grok Bot.** Auto-review is optional and model-based. We should ship **hard default denies** for send / purchase / delete / publish, plus an approval card, so we are stricter than the original.
4. **No dry run in Grok Bot.** Their "test run" hits real websites. We should add a **sandbox / dry-run** mode on the workstation.
5. **Audit.** Their team audit view is "coming." We should log every computer action and tool call from day one.
6. **Skills without recording.** Written skills + "save the process we just used" from the transcript is enough. No 10-minute browser capture.
7. **Chief-of-staff pattern.** Inter-bot talk should be **opt-in / on request**, matching "they can talk to each other if requested" — not a free-for-all that burns tokens.

---

## 6. What "good" looks like for v1 of this clone

A user can:

1. Create Bots and assign each a **role**, standing rules, and an **AI model**.
2. Open a Bot's **own desktop**, watch the cursor move, and see typing.
3. Chat with a Bot; it works in the background on its OS.
4. Start a group or ask two Bots to talk; handoffs are visible.
5. Approve or deny risky actions.
6. Save a written skill and reuse it. No marketplace. No screen recording.

That is the product. Everything else is later.

---

## 7. Source index

Official:

- https://x.ai/news/introducing-grok-bot
- https://docs.x.ai/grok-bot/overview
- https://docs.x.ai/grok-bot/get-started
- https://docs.x.ai/grok-bot/bots
- https://docs.x.ai/grok-bot/chat-and-collaboration
- https://docs.x.ai/grok-bot/computer-and-apps
- https://docs.x.ai/grok-bot/files-and-results
- https://docs.x.ai/grok-bot/skills-routines-and-automations
- https://docs.x.ai/grok-bot/approvals-security-and-privacy
- https://docs.x.ai/grok-bot/settings-and-notifications
- https://docs.x.ai/grok-bot/teams-and-enterprises
- https://docs.x.ai/grok-bot/use-cases
- https://docs.x.ai/grok-bot/mobile
- https://docs.x.ai/grok-bot/faq
- https://docs.x.ai/grok-bot/troubleshooting

Launch-week synthesis that tracks the docs closely: [eesel AI Grok Bot review (12 Aug 2026)](https://www.eesel.ai/blog/grok-bot-review).
