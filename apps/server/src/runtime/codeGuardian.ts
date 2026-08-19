/**
 * Code Guardian — a permanent, repo-health reviewer agent (inspired by Cursor Automations).
 *
 * It is a normal teammate with a "review_only" tool policy (shell + plugins; no GUI, no roster
 * mutations). On a schedule (a disabled-by-default hourly routine) or when a git push webhook fires,
 * it clones/pulls a repo, inspects it, and produces a categorized report — bugs / performance /
 * security / improvements — then DMs the Team Lead. It NEVER auto-merges; it only suggests.
 *
 * Everything here is idempotent so it is safe to call on every boot / re-seed.
 */
import * as store from "../store.js";
import { config, liveModelConfig } from "../config.js";
import { broadcast } from "../bus.js";
import { enqueue } from "./queue.js";
import { runAgentTask } from "./runner.js";
import { composeSkillPrompt } from "./dispatch.js";
import { newTurnBudget } from "./orchestrator.js";

export const CODE_GUARDIAN_NAME = "Code Guardian";
export const CODE_GUARDIAN_SKILL = "Codebase health review";
export const CODE_GUARDIAN_ROUTINE = "Hourly main-branch review";

const SKILL_INSTRUCTIONS = `Review a git repository's health and report structured, actionable findings. Never change production or auto-merge — only suggest.

Steps:
1. Make the repo available under ~/workspace/repo: if it exists, \`git -C ~/workspace/repo pull --ff-only\`; otherwise \`git clone <url> ~/workspace/repo\`. Use the repository named in the request, or the configured default.
2. Orient yourself: \`git -C ~/workspace/repo log --oneline -20\` and skim the structure and recent diffs.
3. If the project has tests or linters, run them (e.g. \`npm test\`, \`npm run lint\`) to surface real failures. Prefer bash over guessing.
4. Categorize every finding under exactly these headings: BUGS, PERFORMANCE, SECURITY, IMPROVEMENTS. Be concrete: file:line, why it matters, and a suggested fix.
5. Write a dated markdown report to ~/workspace/reports/health-<YYYY-MM-DD>.md.
6. Do NOT \`git push\` and do NOT open a PR automatically. NEVER auto-merge. If a PR is explicitly wanted, use request_approval first and only open it after approval.
7. Report back concisely: if a Team Lead exists, send_message_to_agent to them with a short summary (counts per category + the report path). Otherwise finish with task_complete summarizing the findings.

Output: a short summary of findings grouped by the four categories, plus the report file path.`;

function guardianModel(): { provider: store.NewAgent["provider"]; model: string } {
  const live = liveModelConfig();
  if (live) return { provider: live.provider, model: live.model };
  return { provider: "generic", model: "mock-scripted" };
}

/** Create (or update) the Code Guardian agent + skill + disabled routine. Idempotent. */
export function ensureCodeGuardian(): { agentId: string; skillId: string; routineId: string } {
  let agent = store.getAgentByName(CODE_GUARDIAN_NAME);
  const { provider, model } = guardianModel();
  if (!agent) {
    agent = store.createAgent({
      name: CODE_GUARDIAN_NAME,
      roleTitle: "Repo Health Reviewer",
      instructions:
        "You continuously review code health. Point yourself at the configured repo (or one named in the request), find bugs/perf/security/improvement issues, and report them. Suggest fixes; never auto-merge.",
      avatarColor: "#D6453D",
      avatarShape: "drop",
      provider,
      model,
      collaborationEnabled: true,
      stealthBrowsing: false,
      isTeamLead: false,
      team: "",
      toolPolicy: "review_only",
    });
    store.ensureDirectConversation(agent.id);
    broadcast({ type: "agent_updated", agent });
    const conv = store.directConversationForAgent(agent.id);
    if (conv) broadcast({ type: "conversation_updated", conversation: conv });
  }

  let skill = store.getSkillByName(CODE_GUARDIAN_SKILL);
  if (!skill) {
    skill = store.createSkill({
      name: CODE_GUARDIAN_SKILL,
      description: "Clone/pull a repo, find bugs/perf/security/improvements, write a report, DM the lead.",
      instructions: SKILL_INSTRUCTIONS,
      createdByAgentId: agent.id,
    });
    broadcast({ type: "skill_updated", skill });
  } else {
    store.setAgentSkill(agent.id, skill.id, true);
  }

  let routine = store.listRoutines(agent.id).find((r) => r.name === CODE_GUARDIAN_ROUTINE);
  if (!routine) {
    routine = store.createRoutine({
      agentId: agent.id,
      skillId: skill.id,
      name: CODE_GUARDIAN_ROUTINE,
      prompt: config.codeGuardianRepo
        ? `Review ${config.codeGuardianRepo} for health issues.`
        : "Review the configured repository for health issues.",
      schedule: "every 1 hour",
    });
    // Off by default — the user enables it in the Routines panel.
    routine = store.updateRoutine(routine.id, { enabled: false }) ?? routine;
    broadcast({ type: "routine_updated", routine });
  }

  return { agentId: agent.id, skillId: skill.id, routineId: routine.id };
}

/**
 * Trigger a one-off Code Guardian review (from the git webhook or a manual call). Enqueues a task in
 * Code Guardian's own chat. Returns false if Code Guardian doesn't exist yet.
 */
export function triggerCodeGuardianReview(opts: { repo?: string; reason?: string }): boolean {
  const agent = store.getAgentByName(CODE_GUARDIAN_NAME);
  if (!agent) return false;
  const conv = store.ensureDirectConversation(agent.id);
  const skill = store.getSkillByName(CODE_GUARDIAN_SKILL);
  const repo = opts.repo || config.codeGuardianRepo;
  const ask = `Review ${repo ? repo : "the configured repository"} now${opts.reason ? ` (${opts.reason})` : ""}.`;
  const prompt = skill ? composeSkillPrompt(skill, ask) : ask;

  const notice = store.addMessage({
    conversationId: conv.id,
    sender: { kind: "system" },
    kind: "text",
    text: `Code Guardian review started${opts.reason ? `: ${opts.reason}` : ""}`,
  });
  broadcast({ type: "message", message: notice });

  newTurnBudget(notice.id);
  enqueue(agent.id, () =>
    runAgentTask({
      agentId: agent.id,
      conversationId: conv.id,
      prompt,
      rootMessageId: notice.id,
      triggeredBy: { kind: "user" },
    }),
  );
  return true;
}

/** Parse a GitHub-style push payload → the branch and repo, or undefined if not a push. */
export function parsePushPayload(body: unknown): { branch?: string; repo?: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const ref = typeof b.ref === "string" ? b.ref : undefined; // e.g. refs/heads/main
  const branch = ref?.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
  const repoObj = (b.repository ?? {}) as Record<string, unknown>;
  const repo =
    (typeof repoObj.clone_url === "string" && repoObj.clone_url) ||
    (typeof repoObj.ssh_url === "string" && repoObj.ssh_url) ||
    (typeof repoObj.full_name === "string" && repoObj.full_name) ||
    undefined;
  return { branch, repo: repo || undefined };
}
