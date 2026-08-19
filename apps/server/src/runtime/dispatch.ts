/**
 * Grok Bot-style dispatch helpers: who should wake, when to stop, and /skill.
 *
 * Official behavior we clone here:
 * - @Name targets that teammate; @everyone wakes the group
 * - no mention + a team lead → leads own the request and delegate
 * - "Stop now" ends work immediately (does not undo finished actions)
 * - a new user message takes priority over background work
 * - /SkillName invokes a saved skill
 */
import type { Agent, Skill } from "@grokbot/shared";

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Extract @Name tokens that match a known list (case-insensitive, longest first). */
export function extractNamedMentions(text: string, names: string[]): string[] {
  const found: string[] = [];
  const sorted = [...names].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const name of sorted) {
    const re = new RegExp(`@${escapeRe(name)}\\b`, "i");
    if (re.test(text) && !found.some((n) => n.toLowerCase() === name.toLowerCase())) {
      found.push(name);
    }
  }
  return found;
}

/** Extract @mentions matching known agent names (case-insensitive, longest first). */
export function extractMentions(text: string, agents: { id: string; name: string }[]): string[] {
  const names = extractNamedMentions(
    text,
    agents.map((a) => a.name),
  );
  const ids: string[] = [];
  for (const name of names) {
    const agent = agents.find((a) => a.name.toLowerCase() === name.toLowerCase());
    if (agent && !ids.includes(agent.id)) ids.push(agent.id);
  }
  return ids;
}

/** Official @ also attaches plugins (connectors) and routines — not extra wake-ups. */
export function composeMentionContext(opts: {
  pluginNames: string[];
  routines: { name: string; prompt: string }[];
}): string {
  const parts: string[] = [];
  if (opts.pluginNames.length) {
    parts.push(
      `The user attached plugin(s): ${opts.pluginNames.join(", ")}. Prefer call_plugin with those names when relevant.`,
    );
  }
  if (opts.routines.length) {
    parts.push(
      `The user referenced routine(s):\n${opts.routines.map((r) => `- ${r.name}: ${r.prompt}`).join("\n")}`,
    );
  }
  return parts.join("\n");
}

export function isStopCommand(text: string): boolean {
  const t = text.trim();
  return /^(stop now|\/stop|stop|cancel)[.!]?$/i.test(t);
}

export function mentionsEveryone(text: string): boolean {
  return /@everyone\b/i.test(text);
}

export function extractSkillInvocation(
  text: string,
  skills: Pick<Skill, "id" | "name">[],
): { skillId: string; skillName: string; rest: string } | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return undefined;
  const body = trimmed.slice(1);
  const sorted = [...skills].sort((a, b) => b.name.length - a.name.length);
  for (const s of sorted) {
    const re = new RegExp(`^${escapeRe(s.name)}(?:\\b|[\\s,]|$)`, "i");
    if (re.test(body)) {
      return { skillId: s.id, skillName: s.name, rest: body.slice(s.name.length).trim() };
    }
  }
  return undefined;
}

export function composeSkillPrompt(skill: Skill, rest: string): string {
  const extra = rest.trim() ? rest.trim() : "(run the skill as specified)";
  return `The user invoked skill "${skill.name}". Follow it.

## Skill: ${skill.name}
${skill.description ? `${skill.description}\n\n` : ""}${skill.instructions}

## Additional request
${extra}`;
}

export function chooseResponders(opts: {
  conversationKind: "direct" | "group" | "agent_dm";
  members: Pick<Agent, "id" | "name" | "isTeamLead">[];
  text: string;
  mentionedIds: string[];
  skillId?: string;
  membersWithSkill?: string[];
}): string[] {
  const ids = opts.members.map((m) => m.id);
  if (ids.length === 0) return [];
  if (opts.conversationKind !== "group") return ids;

  if (mentionsEveryone(opts.text)) return ids;
  if (opts.mentionedIds.length > 0) {
    return ids.filter((id) => opts.mentionedIds.includes(id));
  }
  if (opts.skillId && opts.membersWithSkill && opts.membersWithSkill.length > 0) {
    return opts.membersWithSkill;
  }
  const leads = opts.members.filter((m) => m.isTeamLead).map((m) => m.id);
  if (leads.length > 0) return leads;
  return ids;
}
