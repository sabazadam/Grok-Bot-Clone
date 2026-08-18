/** High-level agent operations: store + computer lifecycle + event broadcast. */
import type { Agent, AgentStatus, ComputerInfo } from "@grokbot/shared";
import * as store from "../store.js";
import { computerManager } from "../computer/manager.js";
import { broadcast } from "../bus.js";

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
