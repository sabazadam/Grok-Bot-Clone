/**
 * Seed a delegation demo (Team Lead → specialists) so the Phase 3 UI can be verified without Docker:
 * role/policy badges, the in-chat delegation card, and the delegation tree.
 * Run with a throwaway DATA_DIR, e.g.:
 *   DATA_DIR=/tmp/deleg-demo npx tsx apps/server/scripts/seed-delegation-demo.ts
 */
import * as store from "../src/store.js";

function upsert(input: store.NewAgent) {
  const existing = store.getAgentByName(input.name);
  if (existing) return store.updateAgent(existing.id, input)!;
  const agent = store.createAgent(input);
  store.ensureDirectConversation(agent.id);
  return agent;
}

const lead = upsert({
  name: "Team Lead",
  roleTitle: "Orchestrator",
  instructions: "Coordinate specialists; delegate complex work.",
  avatarColor: "#3B82F6",
  avatarShape: "hexagon",
  provider: "generic",
  model: "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: true,
  isTeamLead: true,
  team: "Leaders",
  toolPolicy: "full",
});

const researcher = upsert({
  name: "Researcher",
  roleTitle: "Market Researcher",
  instructions: "Research topics and report structured findings.",
  avatarColor: "#3D8B5A",
  avatarShape: "blob",
  provider: "generic",
  model: "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: true,
  team: "Leaders",
  agentKind: "specialist",
  parentAgentId: lead.id,
  toolPolicy: "research",
});

const coder = upsert({
  name: "Coder",
  roleTitle: "Engineer",
  instructions: "Implement code changes.",
  avatarColor: "#7C5CBF",
  avatarShape: "squircle",
  provider: "generic",
  model: "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: false,
  team: "Leaders",
  agentKind: "specialist",
  parentAgentId: lead.id,
  toolPolicy: "coding",
});

const reviewer = upsert({
  name: "Code Guardian",
  roleTitle: "Repo Health Reviewer",
  instructions: "Review the repo; suggest fixes; never auto-merge.",
  avatarColor: "#D6453D",
  avatarShape: "drop",
  provider: "generic",
  model: "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: false,
  team: "",
  toolPolicy: "review_only",
});

store.setAgentStatus(lead.id, "idle");
store.setAgentStatus(researcher.id, "idle");
store.setAgentStatus(coder.id, "working");
store.setAgentStatus(reviewer.id, "idle");

const leadChat = store.ensureDirectConversation(lead.id);
const dmR = store.ensureAgentDm(lead.id, researcher.id);
const dmC = store.ensureAgentDm(lead.id, coder.id);

function hasText(conversationId: string, text: string): boolean {
  return store.listMessages(conversationId).some((m) => m.text === text);
}

if (!hasText(leadChat.id, "Research the market and scaffold a prototype.")) {
  store.addMessage({
    conversationId: leadChat.id,
    sender: { kind: "user" },
    kind: "text",
    text: "Research the market and scaffold a prototype.",
  });
}
if (!hasText(leadChat.id, "Delegated to Researcher, Coder")) {
  store.addMessage({
    conversationId: leadChat.id,
    sender: { kind: "agent", agentId: lead.id },
    kind: "text",
    text: "Delegated to Researcher, Coder",
    relatedConversationId: dmR.id,
  });
}

// goal messages in the private threads
if (!hasText(dmR.id, "Research the competitive landscape for AI agents")) {
  store.addMessage({ conversationId: dmR.id, sender: { kind: "agent", agentId: lead.id }, kind: "text", text: "Research the competitive landscape for AI agents" });
}
if (!hasText(dmC.id, "Scaffold a Node + React prototype")) {
  store.addMessage({ conversationId: dmC.id, sender: { kind: "agent", agentId: lead.id }, kind: "text", text: "Scaffold a Node + React prototype" });
}

// delegation rows: one done, one running
const existingR = store.listDelegationsByParent(lead.id).find((d) => d.childAgentId === researcher.id);
if (!existingR) {
  const d = store.createDelegation({
    rootMessageId: "seed-root",
    parentAgentId: lead.id,
    childAgentId: researcher.id,
    conversationId: dmR.id,
    goal: "Research the competitive landscape for AI agents",
    role: "leaf",
    depth: 1,
  });
  store.updateDelegation(d.id, { status: "done", resultSummary: "Found 6 competitors; summary saved to workspace/reports.", stepCount: 7, finishedAt: Date.now() });
}
const existingC = store.listDelegationsByParent(lead.id).find((d) => d.childAgentId === coder.id);
if (!existingC) {
  store.createDelegation({
    rootMessageId: "seed-root",
    parentAgentId: lead.id,
    childAgentId: coder.id,
    conversationId: dmC.id,
    goal: "Scaffold a Node + React prototype",
    role: "leaf",
    depth: 1,
  });
}

console.log(JSON.stringify({ lead: lead.id, researcher: researcher.id, coder: coder.id, reviewer: reviewer.id, leadChat: leadChat.id }, null, 2));
