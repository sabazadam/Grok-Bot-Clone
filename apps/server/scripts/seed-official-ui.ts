/**
 * Seed a Grok Bot–style roster + hierarchical thread for UI screenshots.
 * Safe to re-run: updates existing demo agents instead of duplicating them.
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
  name: "TikTok Lead",
  roleTitle: "Team lead",
  instructions: "Coordinate TikTok managers.",
  avatarColor: "#F46A1B",
  avatarShape: "drop",
  provider: "generic",
  model: process.env.XAI_API_KEY ? "deepseek-v4-flash" : "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: true,
  isTeamLead: true,
  team: "Social Media",
});

const manager = upsert({
  name: "TikTok Manager 3",
  roleTitle: "TikTok operator",
  instructions: "Post and report.",
  avatarColor: "#8B5A3C",
  avatarShape: "hexagon",
  provider: "generic",
  model: process.env.XAI_API_KEY ? "deepseek-v4-flash" : "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: true,
  team: "Social Media",
});

const kinguin = upsert({
  name: "Alya Deniz Manager",
  roleTitle: "Account manager",
  instructions: "Own the Kinguin account.",
  avatarColor: "#6B4F3A",
  avatarShape: "cloud",
  provider: "generic",
  model: process.env.XAI_API_KEY ? "deepseek-v4-flash" : "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: true,
  team: "Kinguin",
});

const brainstormer = upsert({
  name: "Brainstormer",
  roleTitle: "Ideas",
  instructions: "Brainstorm campaigns.",
  avatarColor: "#E56B8A",
  avatarShape: "blob",
  provider: "generic",
  model: process.env.XAI_API_KEY ? "deepseek-v4-flash" : "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: true,
  team: "",
});

const seeker = upsert({
  name: "Kassel Job seeker",
  roleTitle: "Recruiter",
  instructions: "Find roles.",
  avatarColor: "#F46A1B",
  avatarShape: "triangle",
  provider: "generic",
  model: process.env.XAI_API_KEY ? "deepseek-v4-flash" : "mock-scripted",
  collaborationEnabled: true,
  stealthBrowsing: true,
  team: "",
});

store.setAgentStatus(lead.id, "idle");
store.setAgentStatus(manager.id, "waiting_approval");
store.setAgentStatus(kinguin.id, "idle");
store.setAgentStatus(brainstormer.id, "idle");
store.setAgentStatus(seeker.id, "working");

const leadChat = store.ensureDirectConversation(lead.id);
const managerChat = store.ensureDirectConversation(manager.id);
const dm = store.ensureAgentDm(lead.id, manager.id);

function hasText(conversationId: string, text: string): boolean {
  return store.listMessages(conversationId).some((m) => m.text === text);
}

const now = Date.now();
const older = now - 18 * 60 * 60 * 1000;

if (!hasText(leadChat.id, "Ask TikTok Manager 3 to sign in and report back.")) {
  store.addMessage({
    conversationId: leadChat.id,
    sender: { kind: "user" },
    kind: "text",
    text: "Ask TikTok Manager 3 to sign in and report back.",
  });
}
if (!hasText(leadChat.id, "On it — I'll brief the manager now.")) {
  store.addMessage({
    conversationId: leadChat.id,
    sender: { kind: "agent", agentId: lead.id },
    kind: "text",
    text: "On it — I'll brief the manager now.",
  });
}
if (!hasText(leadChat.id, "Messaged TikTok Manager 3")) {
  store.addMessage({
    conversationId: leadChat.id,
    sender: { kind: "agent", agentId: lead.id },
    kind: "text",
    text: "Messaged TikTok Manager 3",
    relatedConversationId: dm.id,
  });
}

const brief = "Sign in to TikTok, then pause for 2FA. Do not post until I review.";
if (!hasText(dm.id, brief)) {
  store.addMessage({
    conversationId: dm.id,
    sender: { kind: "agent", agentId: lead.id },
    kind: "text",
    text: brief,
  });
}
if (!hasText(dm.id, "Opening TikTok now. I'll wait on the login page.")) {
  store.addMessage({
    conversationId: dm.id,
    sender: { kind: "agent", agentId: manager.id },
    kind: "text",
    text: "Opening TikTok now. I'll wait on the login page.",
  });
}

if (!hasText(managerChat.id, "From TikTok Lead")) {
  store.addMessage({
    conversationId: managerChat.id,
    sender: { kind: "agent", agentId: lead.id },
    kind: "text",
    text: "From TikTok Lead",
    relatedConversationId: dm.id,
  });
}
if (!hasText(managerChat.id, "Sign in to TikTok so I can continue the scheduled posts.")) {
  store.addMessage({
    conversationId: managerChat.id,
    sender: { kind: "agent", agentId: manager.id },
    kind: "approval_request",
    text: "Sign in to TikTok so I can continue the scheduled posts.",
  });
}

void older;
console.log(
  JSON.stringify(
    {
      lead: lead.id,
      manager: manager.id,
      kinguin: kinguin.id,
      brainstormer: brainstormer.id,
      seeker: seeker.id,
      leadChat: leadChat.id,
      managerChat: managerChat.id,
      dm: dm.id,
    },
    null,
    2,
  ),
);
