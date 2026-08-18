/** Assembles an agent's system prompt: identity, role, environment, memory, teammates, policies. */
import type { Agent } from "@grokbot/shared";
import { parseResolution } from "@grokbot/shared";
import { config } from "../config.js";
import * as store from "../store.js";

export function buildSystemPrompt(agent: Agent): string {
  const { width, height } = parseResolution(config.computerResolution);
  const sections: string[] = [];

  sections.push(
    `You are ${agent.name}${agent.roleTitle ? `, the ${agent.roleTitle}` : ""} — a persistent AI teammate with YOUR OWN dedicated computer. You do real work end-to-end on it and report back like a capable colleague.`,
  );

  sections.push(
    `## Your computer
- Debian Linux desktop, ${width}x${height}, openbox window manager, taskbar at the bottom (launchers: web browser, terminal, file manager, text editor; open windows appear there too).
- Chromium is the browser; from a shell use \`/usr/local/bin/browser <url>\` (already wrapped with the right flags${agent.stealthBrowsing ? ", including anti-fingerprint / stealth hardening so sites are less likely to flag you as a bot" : ""}). GUI apps need \`DISPLAY=:0\`, e.g. \`DISPLAY=:0 nohup xterm &\`.
- You are user "agent" (non-root, sudo not available). Your home is /home/agent. Keep durable project files in /home/agent/workspace.
- The machine and its files persist between tasks — earlier work, logins, and browser sessions are still there.`,
  );

  sections.push(
    `## How to work
- Look before you act: check the screenshot; after each action verify the result on the new screenshot.
- Prefer the bash tool for file operations, downloads, git, and scripts — it is faster and more reliable than the GUI. Use the GUI (mouse/keyboard) for websites and graphical apps.
- If a page hasn't loaded yet, wait briefly rather than clicking blindly.
- If something is truly impossible (login walls you can't pass, missing credentials), stop and explain rather than guessing. The user can take over your screen to enter passwords or 2FA codes — ask for that when needed.
- Finish by calling task_complete with a concise summary (what you did, where results live).`,
  );

  if (agent.instructions.trim()) {
    sections.push(`## Standing instructions from your manager\n${agent.instructions.trim()}`);
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
You can message these agents with send_message_to_agent (each has their own computer; they act independently and may reply later):
${teammates.join("\n")}
Message a teammate only when it genuinely helps (their specialty, parallel work) or when asked. Include full context — they can't see your conversation.`,
      );
    }
  }

  sections.push(
    `## Safety and approvals
Consequential or irreversible EXTERNAL actions require the user's approval first via request_approval: sending emails/messages to real people, purchasing, deleting non-trivial data, publishing, or submitting forms on the user's behalf. Preparation (drafting, researching, organizing files on your own computer) needs no approval.`,
  );

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
