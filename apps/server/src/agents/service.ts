/** High-level agent operations: store + computer lifecycle + event broadcast. */
import type { Agent, AgentStatus, ComputerInfo } from "@grokbot/shared";
import * as store from "../store.js";
import { computerManager } from "../computer/manager.js";
import { config } from "../config.js";
import { broadcast } from "../bus.js";

/** Push an agent's browser settings into its running container. */
export async function syncBrowserConfig(agentId: string): Promise<void> {
  const agent = store.getAgent(agentId);
  if (!agent) return;
  await computerManager.syncBrowserConfig(agentId, {
    stealth: agent.stealthBrowsing,
    userAgent: config.browserUserAgent,
    timezone: config.browserTimezone,
    locale: config.browserLocale,
  });
}

export async function agentWithComputer(agent: Agent): Promise<Agent> {
  try {
    const computer: ComputerInfo = await computerManager.status(agent.id);
    return { ...agent, computer };
  } catch {
    return agent;
  }
}

export function setStatus(agentId: string, status: AgentStatus): void {
  store.setAgentStatus(agentId, status);
  broadcast({ type: "agent_status", agentId, status });
}

export async function createAgent(input: store.NewAgent): Promise<Agent> {
  const agent = store.createAgent(input);
  const conv = store.createConversation("direct", agent.name, [agent.id]);
  broadcast({ type: "conversation_updated", conversation: conv });
  broadcast({ type: "agent_updated", agent });
  // Provision its computer in the background so first task starts fast.
  void provisionComputer(agent.id);
  return agent;
}

export async function provisionComputer(agentId: string): Promise<void> {
  setStatus(agentId, "starting");
  try {
    await computerManager.ensureRunning(agentId);
    await syncBrowserConfig(agentId);
    setStatus(agentId, "idle");
  } catch (err) {
    setStatus(agentId, "error");
    const conv = store.directConversationForAgent(agentId);
    if (conv) {
      const msg = store.addMessage({
        conversationId: conv.id,
        sender: { kind: "system" },
        kind: "error",
        text: `Couldn't start this agent's computer: ${(err as Error).message}`,
      });
      broadcast({ type: "message", message: msg });
    }
  }
  const agent = store.getAgent(agentId);
  if (agent) broadcast({ type: "agent_updated", agent: await agentWithComputer(agent) });
}

export async function stopComputer(agentId: string): Promise<void> {
  await computerManager.stop(agentId);
  setStatus(agentId, "off");
  const agent = store.getAgent(agentId);
  if (agent) broadcast({ type: "agent_updated", agent: await agentWithComputer(agent) });
}

export async function deleteAgent(agentId: string, deleteData: boolean): Promise<void> {
  await computerManager.destroy(agentId, deleteData).catch(() => undefined);
  store.deleteAgent(agentId);
}

/**
 * Duplicate an agent's profile/settings (NOT its conversation history or memory),
 * matching Grok Bot's documented "duplicate" behavior. Creates a fresh direct chat
 * and provisions a new computer.
 */
export async function duplicateAgent(agentId: string): Promise<Agent | undefined> {
  const src = store.getAgent(agentId);
  if (!src) return undefined;
  let name = `${src.name} copy`;
  let n = 2;
  while (store.getAgentByName(name)) {
    name = `${src.name} copy ${n++}`;
  }
  const copy = store.createAgent({
    name,
    roleTitle: src.roleTitle,
    instructions: src.instructions,
    avatarColor: src.avatarColor,
    provider: src.provider,
    model: src.model,
    collaborationEnabled: src.collaborationEnabled,
    stealthBrowsing: src.stealthBrowsing,
    isTeamLead: src.isTeamLead,
  });
  store.copyAgentSkills(src.id, copy.id);
  const conv = store.createConversation("direct", copy.name, [copy.id]);
  broadcast({ type: "conversation_updated", conversation: conv });
  broadcast({ type: "agent_updated", agent: copy });
  void provisionComputer(copy.id);
  return copy;
}

export async function setHidden(agentId: string, hidden: boolean): Promise<Agent | undefined> {
  const agent = store.setAgentHidden(agentId, hidden);
  if (agent) {
    const full = await agentWithComputer(agent);
    broadcast({ type: "agent_updated", agent: full });
    return full;
  }
  return undefined;
}
