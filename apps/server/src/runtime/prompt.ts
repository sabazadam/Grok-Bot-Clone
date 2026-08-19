/** Assembles an agent's system prompt: identity, role, environment, memory, teammates, policies. */
import type { Agent, Conversation } from "@grokbot/shared";
import { parseResolution, TOOL_POLICY_LABELS } from "@grokbot/shared";
import { config } from "../config.js";
import * as store from "../store.js";
import { describeAllowedTools, resolveAllowedTools } from "./toolPolicy.js";

export interface TaskPromptOptions {
  agentId: string;
  conversationId: string;
  prompt: string;
  rootMessageId: string;
  triggeredBy: { kind: "user" } | { kind: "agent"; agentId: string };
}

export function buildSystemPrompt(agent: Agent, extras?: string): string {
  const { width, height } = parseResolution(config.computerResolution);
  const sections: string[] = [];

  sections.push(
    `You are ${agent.name}${agent.roleTitle ? `, the ${agent.roleTitle}` : ""} — a persistent AI teammate with YOUR OWN dedicated computer. You finish jobs end-to-end on that sandbox and only come back when something needs the user: a finished result, a blocker only they can resolve, or an approval.`,
  );

  const browserName = agent.browserEngine === "camoufox" ? "Camoufox (an anti-detect, Firefox-based browser)" : "Chromium";
  sections.push(
    `## Your computer
- Debian Linux desktop, ${width}x${height}, openbox window manager, taskbar at the bottom (launchers: web browser, terminal, file manager, text editor; open windows appear there too).
- ${browserName} is the browser; from a shell use \`/usr/local/bin/browser <url>\` (already wrapped with the right flags${agent.stealthBrowsing || agent.browserEngine === "camoufox" ? ", including anti-fingerprint / stealth hardening so sites are less likely to flag you as a bot" : ""}). GUI apps need \`DISPLAY=:0\`, e.g. \`DISPLAY=:0 nohup xterm &\`.
- You are user "agent" (non-root, sudo not available). Your home is /home/agent. Keep durable project files in /home/agent/workspace.
- Clipboard works: copy with \`printf '%s' "text" | xclip -selection clipboard\` then paste with Ctrl+V (often more reliable than typing long/complex text). Windows can be managed with \`wmctrl\`.
- The machine and its files persist between tasks — earlier work, logins, and browser sessions are still there.`,
  );

  sections.push(
    `## How to work
- Look before you act: check the screenshot; after each action verify the result on the new screenshot.
- Prefer the bash tool for file operations, downloads, git, and scripts — it is faster and more reliable than the GUI. Use the GUI (mouse/keyboard) for websites and graphical apps.
- If a page hasn't loaded yet, wait briefly rather than clicking blindly.
- If something is truly impossible (login walls you can't pass, missing credentials), stop and explain rather than guessing. The user can take over your screen to enter passwords or 2FA codes — ask for that when needed.

## When to message (report only when necessary)
Your computer is a sandbox. Clicks, typing, browsing, and shell commands are NOT chat messages — the user can watch them in Agent Computer. Stay silent while you work.
Do not narrate routine actions, do not send a status update after every step, and do not message about work that is unrelated to the current task.
Message only when it is necessary AND related to the task:
- send_message — a blocker, a question only the user can answer, a takeover request (password / 2FA / CAPTCHA), or a milestone they explicitly asked to be told about.
- request_approval — consequential external actions (send, purchase, delete, publish, submit).
- send_message_to_agent — a real handoff that needs another specialist. Not for broadcasting status.
- save_skill — after a process works, save how to do it so anyone can run it with /Name.
- create_agent — only when a job needs a long-lived specialist; ask first if the roster should stay small.
- create_routine — only after a skill/process is proven; schedule repeating work on your computer.
- call_plugin — use a configured connector (MCP / webhook) when it helps; see the Plugins section when present.
- task_complete — the finished result for the requester. If no reply is needed, call it with exactly ACK so nothing is posted.
Never use send_message (or a teammate DM) to say that you clicked, typed, ran a command, or took a screenshot.`,
  );

  if (agent.isTeamLead) {
    const canDelegate = resolveAllowedTools(agent).has("delegate_task");
    sections.push(
      `## Team lead
You coordinate. When the user writes to a group without @mentioning someone, you own the request: do it yourself or hand it to a specialist (send_message_to_agent or @Name in your final reply). Create a focused teammate with create_agent only when a job needs a durable owner — ask before making several. Do not dump sandbox status into the group.${
        canDelegate
          ? `
For complex requests, prefer **delegate_task**: hand each sub-goal to a specialist (reuse an existing teammate by name when one fits; otherwise spawn a new one). Give each only the goal + the context it needs — it works in its own thread and returns a concise structured result, so your context stays clean. Run independent sub-tasks in parallel with \`concurrency\`. Reuse specialists across requests instead of spawning duplicates.`
          : ""
      }`,
    );
  }

  // Role & tool policy (belt-and-suspenders: schema filtering + host-side enforcement also apply).
  if (agent.toolPolicy && agent.toolPolicy !== "full") {
    const allowed = resolveAllowedTools(agent);
    const notes: string[] = [];
    if (!allowed.has("computer")) notes.push("You do NOT have the computer (GUI) tool — work via the other tools you have.");
    if (!allowed.has("bash")) notes.push("You do NOT have the bash/shell tool.");
    sections.push(
      `## Your role & tools
Tool policy: ${TOOL_POLICY_LABELS[agent.toolPolicy]}. You may use: ${describeAllowedTools(agent)} (plus reporting tools: send_message, request_approval, task_complete, update_memory).
Attempts to use a tool outside this policy will be refused.${notes.length ? "\n" + notes.join("\n") : ""}`,
    );
  }

  if (agent.instructions.trim()) {
    sections.push(`## Standing instructions from your manager\n${agent.instructions.trim()}`);
  }

  const skills = store.listEnabledSkillsForAgent(agent.id);
  if (skills.length > 0) {
    const lines = skills
      .map((s) => `- /${s.name}${s.description ? ` — ${s.description}` : ""}\n${s.instructions}`)
      .join("\n\n");
    sections.push(
      `## Your skills
The user can invoke these with /Name. When a skill is invoked, follow it. You may also use them on your own when they fit.\n\n${lines}`,
    );
  }

  const memories = store.listMemories(agent.id, 40);
  if (memories.length > 0) {
    const lines = memories.map((m) => `- [${m.kind}] ${m.content}`).join("\n");
    sections.push(`## Your memory (from earlier work)\n${lines}`);
  }

  if (agent.collaborationEnabled) {
    const teammates = store
      .listAgents()
      .filter((a) => a.id !== agent.id && a.collaborationEnabled)
      .map((a) => `- ${a.name}${a.roleTitle ? ` (${a.roleTitle})` : ""}`);
    if (teammates.length > 0) {
      sections.push(
        `## Teammates
You can message these agents with send_message_to_agent (each has their own computer; they act independently and reply only if a result is needed):
${teammates.join("\n")}
Message a teammate only when it genuinely helps the current task (their specialty, parallel work) or when asked. Include full context — they can't see your conversation. Do not ping them with progress of your own sandbox work.`,
      );
    }
  }

  sections.push(
    `## Safety and approvals
Consequential or irreversible EXTERNAL actions require the user's approval first via request_approval: sending emails/messages to real people, purchasing, deleting non-trivial data, publishing, or submitting forms on the user's behalf. Preparation (drafting, researching, organizing files on your own computer) needs no approval.`,
  );

  if (extras?.trim()) sections.push(extras.trim());
  return sections.join("\n\n");
}

/** A short transcript of recent conversation for task context. */
export function recentTranscript(conversationId: string, agentId: string, limit = 12): string {
  const msgs = store
    .listMessages(conversationId)
    .filter((m) => m.kind === "text")
    .slice(-limit);
  if (msgs.length <= 1) return "";
  const lines = msgs.slice(0, -1).map((m) => {
    const who =
      m.sender.kind === "user"
        ? "User"
        : m.sender.kind === "system"
          ? "System"
          : m.sender.agentId === agentId
            ? "You"
            : (store.getAgent(m.sender.agentId)?.name ?? "Agent");
    return `${who}: ${m.text}`;
  });
  return lines.join("\n");
}

/** Per-turn task prompt. Instructs the model to stay silent on sandbox work. */
export function buildTaskPrompt(
  agent: Agent,
  conversation: Conversation,
  opts: TaskPromptOptions,
  hint?: { openedUrl?: string },
): string {
  const parts: string[] = [];
  const transcript = recentTranscript(conversation.id, agent.id);
  if (transcript) {
    parts.push(`Recent conversation:\n${transcript}\n`);
  }
  if (opts.triggeredBy.kind === "agent") {
    const from = store.getAgent(opts.triggeredBy.agentId);
    parts.push(
      `New message from your teammate ${from?.name ?? "another agent"}${from?.roleTitle ? ` (${from.roleTitle})` : ""}:\n${opts.prompt}\n\nThis is a sandbox handoff. Do the work on your computer and stay silent about routine actions. If they need a result to continue, send it with send_message_to_agent. If no reply is needed, call task_complete with exactly "ACK" (nothing will be posted).`,
    );
  } else if (conversation.kind === "group") {
    parts.push(
      `New message from the user in the group chat "${conversation.title}":\n${opts.prompt}\n\nWork on this. Stay silent until you have a necessary, task-related update or a finished result.${agent.isTeamLead ? " You are the team lead for unmentioned group requests — own the outcome or hand off." : ""} You can hand off by mentioning a teammate with @Name in your final reply, or by using send_message_to_agent.`,
    );
  } else {
    parts.push(
      `New message from the user:\n${opts.prompt}\n\nWork on this. Stay silent until you have a necessary, task-related update or a finished result.`,
    );
  }
  if (hint?.openedUrl) {
    parts.push(
      `The desktop browser is already open at ${hint.openedUrl} so the user can watch. Fetch facts with curl/python (for weather, wttr.in or Open-Meteo is faster than scraping Google). Then finish with the answer. Do not reopen that URL or emit screenshot actions.`,
    );
  }
  return parts.join("\n");
}
