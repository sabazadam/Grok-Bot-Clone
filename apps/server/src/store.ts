/** Typed repository over SQLite rows <-> shared entities. */
import { nanoid } from "nanoid";
import type {
  Agent,
  AgentStatus,
  Approval,
  ApprovalStatus,
  Conversation,
  ConversationKind,
  Delegation,
  MemoryEntry,
  MemoryKind,
  Message,
  MessageKind,
  MessageSender,
  Plugin,
  PluginKind,
  Provider,
  Routine,
  RoutineSchedule,
  SearchHit,
  Skill,
  Task,
  TaskStatus,
  Attachment,
} from "@grokbot/shared";
import { FACE_SHAPES, formatSchedule, intervalMinutesOf, nextRunAt, parseSchedule, withWindowStart, type FaceShape } from "@grokbot/shared";
import { config } from "./config.js";
import { getDb } from "./db.js";

// ── mappers ─────────────────────────────────────────────────────────────

function rowToAgent(r: any): Agent {
  return {
    id: r.id,
    name: r.name,
    roleTitle: r.role_title,
    instructions: r.instructions,
    avatarColor: r.avatar_color,
    avatarShape: (r.avatar_shape as Agent["avatarShape"]) || undefined,
    provider: r.provider as Provider,
    model: r.model,
    collaborationEnabled: !!r.collaboration_enabled,
    stealthBrowsing: !!r.stealth_browsing,
    browserEngine: (r.browser_engine as Agent["browserEngine"]) || "chromium",
    hidden: !!r.hidden,
    isTeamLead: !!r.is_team_lead,
    team: (r.team as string) ?? "",
    agentKind: (r.agent_kind as Agent["agentKind"]) || "standard",
    parentAgentId: r.parent_agent_id ?? undefined,
    toolPolicy: (r.tool_policy as Agent["toolPolicy"]) || "full",
    toolAllow: parseJson<string[] | undefined>(r.tool_allow, undefined),
    status: r.status as AgentStatus,
    createdAt: r.created_at,
  };
}

function rowToConversation(r: any): Conversation {
  return {
    id: r.id,
    kind: r.kind as ConversationKind,
    title: r.title,
    agentIds: JSON.parse(r.agent_ids),
    pinned: !!r.pinned,
    pinnedAt: r.pinned_at ?? undefined,
    createdAt: r.created_at,
    lastMessageAt: r.last_message_at,
  };
}

function rowToMessage(r: any): Message {
  const sender: MessageSender =
    r.sender_kind === "user"
      ? { kind: "user" }
      : r.sender_kind === "system"
        ? { kind: "system" }
        : { kind: "agent", agentId: r.sender_agent_id };
  return {
    id: r.id,
    conversationId: r.conversation_id,
    sender,
    kind: r.kind as MessageKind,
    text: r.text,
    approvalId: r.approval_id ?? undefined,
    screenshotUrl: r.screenshot_url ?? undefined,
    relatedConversationId: r.related_conversation_id ?? undefined,
    attachments: parseJson<Attachment[] | undefined>(r.attachments_json, undefined),
    reactions: parseJson<Record<string, number> | undefined>(r.reactions_json, undefined),
    createdAt: r.created_at,
  };
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (!raw || typeof raw !== "string") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToTask(r: any): Task {
  return {
    id: r.id,
    agentId: r.agent_id,
    conversationId: r.conversation_id,
    prompt: r.prompt,
    status: r.status as TaskStatus,
    stepCount: r.step_count,
    resultSummary: r.result_summary ?? undefined,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? undefined,
  };
}

function rowToApproval(r: any): Approval {
  return {
    id: r.id,
    taskId: r.task_id,
    agentId: r.agent_id,
    conversationId: r.conversation_id,
    actionDescription: r.action_description,
    actionJson: r.action_json,
    reason: r.reason,
    status: r.status as ApprovalStatus,
    createdAt: r.created_at,
  };
}

function rowToMemory(r: any): MemoryEntry {
  return { id: r.id, agentId: r.agent_id, kind: r.kind as MemoryKind, content: r.content, createdAt: r.created_at };
}

// ── agents ──────────────────────────────────────────────────────────────

export interface NewAgent {
  name: string;
  roleTitle: string;
  instructions: string;
  avatarColor: string;
  avatarShape?: Agent["avatarShape"];
  provider: Provider;
  model: string;
  collaborationEnabled: boolean;
  stealthBrowsing: boolean;
  browserEngine?: Agent["browserEngine"];
  isTeamLead?: boolean;
  team?: string;
  agentKind?: Agent["agentKind"];
  parentAgentId?: string;
  toolPolicy?: Agent["toolPolicy"];
  toolAllow?: string[];
}

export function createAgent(a: NewAgent): Agent {
  const id = nanoid(10);
  getDb()
    .prepare(
      `INSERT INTO agents (id, name, role_title, instructions, avatar_color, avatar_shape, provider, model, collaboration_enabled, stealth_browsing, browser_engine, hidden, is_team_lead, team, agent_kind, parent_agent_id, tool_policy, tool_allow, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'off', ?)`,
    )
    .run(
      id,
      a.name,
      a.roleTitle,
      a.instructions,
      a.avatarColor,
      a.avatarShape ?? null,
      a.provider,
      a.model,
      a.collaborationEnabled ? 1 : 0,
      a.stealthBrowsing ? 1 : 0,
      a.browserEngine ?? "chromium",
      a.isTeamLead ? 1 : 0,
      a.team?.trim() ?? "",
      a.agentKind ?? "standard",
      a.parentAgentId ?? null,
      a.toolPolicy ?? "full",
      a.toolAllow && a.toolAllow.length ? JSON.stringify(a.toolAllow) : null,
      Date.now(),
    );
  return getAgent(id)!;
}

export function getAgent(id: string): Agent | undefined {
  const r = getDb().prepare(`SELECT * FROM agents WHERE id = ?`).get(id);
  return r ? rowToAgent(r) : undefined;
}

export function getAgentByName(name: string): Agent | undefined {
  const r = getDb().prepare(`SELECT * FROM agents WHERE lower(name) = lower(?)`).get(name);
  return r ? rowToAgent(r) : undefined;
}

export function listAgents(): Agent[] {
  return getDb().prepare(`SELECT * FROM agents ORDER BY created_at ASC`).all().map(rowToAgent);
}

/** Official Grok Bot caps the sidebar at 50 Bots + group chats combined. */
export const ROSTER_LIMIT = 50;
export const GROUP_MEMBER_MIN = 2;
export const GROUP_MEMBER_MAX = 6;

export function rosterCount(): number {
  return listAgents().length + listConversations().filter((c) => c.kind === "group").length;
}

/**
 * Repair statuses that survived a restart or a seed script (waiting with no
 * approval, working with no task). Leave `starting` alone so computer boot
 * is not clobbered.
 */
export function reconcileAgentStatuses(): { agentId: string; status: AgentStatus }[] {
  const changes: { agentId: string; status: AgentStatus }[] = [];
  for (const agent of listAgents()) {
    const pending = listPendingApprovalsForAgent(agent.id);
    const active = listActiveTasksForAgent(agent.id);
    let next: AgentStatus | undefined;
    if (pending.length > 0 || active.some((t) => t.status === "waiting_approval")) {
      next = "waiting_approval";
    } else if (active.length > 0) {
      if (agent.status === "starting") continue;
      next = "working";
    } else if (agent.status === "waiting_approval" || agent.status === "working") {
      next = "idle";
    }
    if (!next || next === agent.status) continue;
    setAgentStatus(agent.id, next);
    changes.push({ agentId: agent.id, status: next });
  }
  return changes;
}

export function updateAgent(id: string, patch: Partial<NewAgent>): Agent | undefined {
  const cur = getAgent(id);
  if (!cur) return undefined;
  const merged = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE agents SET name=?, role_title=?, instructions=?, avatar_color=?, avatar_shape=?, provider=?, model=?, collaboration_enabled=?, stealth_browsing=?, browser_engine=?, is_team_lead=?, team=?, agent_kind=?, parent_agent_id=?, tool_policy=?, tool_allow=? WHERE id=?`,
    )
    .run(
      merged.name,
      merged.roleTitle,
      merged.instructions,
      merged.avatarColor,
      merged.avatarShape ?? null,
      merged.provider,
      merged.model,
      merged.collaborationEnabled ? 1 : 0,
      merged.stealthBrowsing ? 1 : 0,
      merged.browserEngine ?? "chromium",
      merged.isTeamLead ? 1 : 0,
      merged.team?.trim() ?? "",
      merged.agentKind ?? "standard",
      merged.parentAgentId ?? null,
      merged.toolPolicy ?? "full",
      merged.toolAllow && merged.toolAllow.length ? JSON.stringify(merged.toolAllow) : null,
      id,
    );
  return getAgent(id);
}

export function setAgentStatus(id: string, status: AgentStatus): void {
  getDb().prepare(`UPDATE agents SET status=? WHERE id=?`).run(status, id);
}

/** Switch leftover mock-scripted teammates onto a live provider once a key exists. */
export function promoteMockAgents(provider: Provider, model: string): Agent[] {
  const changed: Agent[] = [];
  for (const agent of listAgents()) {
    if (agent.model !== "mock-scripted") continue;
    const next = updateAgent(agent.id, { provider, model });
    if (next) changed.push(next);
  }
  return changed;
}

/** Persist an official Bot picker shape so the roster looks distinct. */
export function assignMissingFaceShapes(): Agent[] {
  const agents = listAgents();
  const used = new Set(agents.map((a) => a.avatarShape).filter((s): s is FaceShape => !!s));
  const changed: Agent[] = [];
  let fallback = 0;
  for (const agent of agents) {
    if (agent.avatarShape) continue;
    let shape = FACE_SHAPES.find((s) => !used.has(s));
    if (!shape) {
      shape = FACE_SHAPES[fallback % FACE_SHAPES.length]!;
      fallback += 1;
    }
    used.add(shape);
    const next = updateAgent(agent.id, { avatarShape: shape });
    if (next) changed.push(next);
  }
  return changed;
}

export function setAgentHidden(id: string, hidden: boolean): Agent | undefined {
  getDb().prepare(`UPDATE agents SET hidden=? WHERE id=?`).run(hidden ? 1 : 0, id);
  return getAgent(id);
}

export function deleteAgent(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM agents WHERE id=?`).run(id);
  // remove conversations that only involved this agent
  const convs = db.prepare(`SELECT * FROM conversations`).all().map(rowToConversation);
  for (const c of convs) {
    if (c.agentIds.includes(id)) {
      const remaining = c.agentIds.filter((a) => a !== id);
      if (remaining.length === 0 || c.kind !== "group") {
        db.prepare(`DELETE FROM messages WHERE conversation_id=?`).run(c.id);
        db.prepare(`DELETE FROM conversations WHERE id=?`).run(c.id);
      } else {
        db.prepare(`UPDATE conversations SET agent_ids=? WHERE id=?`).run(JSON.stringify(remaining), c.id);
      }
    }
  }
  db.prepare(`DELETE FROM memories WHERE agent_id=?`).run(id);
  db.prepare(`DELETE FROM tasks WHERE agent_id=?`).run(id);
  db.prepare(`DELETE FROM agent_skills WHERE agent_id=?`).run(id);
  db.prepare(`DELETE FROM routines WHERE agent_id=?`).run(id);
}

// ── conversations ───────────────────────────────────────────────────────

export function createConversation(kind: ConversationKind, title: string, agentIds: string[]): Conversation {
  const id = nanoid(10);
  const now = Date.now();
  getDb()
    .prepare(`INSERT INTO conversations (id, kind, title, agent_ids, created_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, kind, title, JSON.stringify(agentIds), now, now);
  return getConversation(id)!;
}

export function getConversation(id: string): Conversation | undefined {
  const r = getDb().prepare(`SELECT * FROM conversations WHERE id=?`).get(id);
  return r ? rowToConversation(r) : undefined;
}

export function listConversations(): Conversation[] {
  return getDb()
    .prepare(`SELECT * FROM conversations`)
    .all()
    .map(rowToConversation)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.pinned && b.pinned) return (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0);
      return b.lastMessageAt - a.lastMessageAt;
    });
}

export function setConversationPinned(id: string, pinned: boolean): Conversation | undefined {
  if (!getConversation(id)) return undefined;
  getDb()
    .prepare(`UPDATE conversations SET pinned=?, pinned_at=? WHERE id=?`)
    .run(pinned ? 1 : 0, pinned ? Date.now() : null, id);
  return getConversation(id);
}

/** The 1:1 user<->agent conversation (created on agent creation). */
export function directConversationForAgent(agentId: string): Conversation | undefined {
  return listConversations().find((c) => c.kind === "direct" && c.agentIds.length === 1 && c.agentIds[0] === agentId);
}

/** The agent's own chat, created if missing. */
export function ensureDirectConversation(agentId: string): Conversation {
  const existing = directConversationForAgent(agentId);
  if (existing) return existing;
  const name = getAgent(agentId)?.name ?? "Agent";
  return createConversation("direct", name, [agentId]);
}

/** View-only lead↔teammate thread. Not listed in the sidebar. */
export function ensureAgentDm(agentIdA: string, agentIdB: string): Conversation {
  const ids = [agentIdA, agentIdB].slice().sort();
  const key = ids.join("\0");
  const existing = listConversations().find((c) => {
    if (c.kind !== "agent_dm" || c.agentIds.length !== 2) return false;
    return c.agentIds.slice().sort().join("\0") === key;
  });
  if (existing) return existing;
  const na = getAgent(ids[0]!)?.name ?? "Agent";
  const nb = getAgent(ids[1]!)?.name ?? "Agent";
  return createConversation("agent_dm", `${na} ↔ ${nb}`, ids);
}

export function agentDmFor(agentIdA: string, agentIdB: string): Conversation | undefined {
  const key = [agentIdA, agentIdB].slice().sort().join("\0");
  return listConversations().find((c) => {
    if (c.kind !== "agent_dm" || c.agentIds.length !== 2) return false;
    return c.agentIds.slice().sort().join("\0") === key;
  });
}

export function renameConversation(id: string, title: string): void {
  getDb().prepare(`UPDATE conversations SET title=? WHERE id=?`).run(title, id);
}

export function deleteConversation(id: string): void {
  getDb().prepare(`DELETE FROM messages WHERE conversation_id=?`).run(id);
  getDb().prepare(`DELETE FROM conversations WHERE id=?`).run(id);
}

export function setConversationAgents(id: string, agentIds: string[]): Conversation | undefined {
  if (!getConversation(id)) return undefined;
  getDb().prepare(`UPDATE conversations SET agent_ids=? WHERE id=?`).run(JSON.stringify(agentIds), id);
  return getConversation(id);
}

// ── messages ────────────────────────────────────────────────────────────

export interface NewMessage {
  conversationId: string;
  sender: MessageSender;
  kind: MessageKind;
  text: string;
  approvalId?: string;
  screenshotUrl?: string;
  relatedConversationId?: string;
  attachments?: Attachment[];
  reactions?: Record<string, number>;
}

export function addMessage(m: NewMessage): Message {
  const id = nanoid(12);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_kind, sender_agent_id, kind, text, approval_id, screenshot_url, related_conversation_id, attachments_json, reactions_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      m.conversationId,
      m.sender.kind,
      m.sender.kind === "agent" ? m.sender.agentId : null,
      m.kind,
      m.text,
      m.approvalId ?? null,
      m.screenshotUrl ?? null,
      m.relatedConversationId ?? null,
      m.attachments?.length ? JSON.stringify(m.attachments) : null,
      m.reactions && Object.keys(m.reactions).length ? JSON.stringify(m.reactions) : null,
      now,
    );
  getDb().prepare(`UPDATE conversations SET last_message_at=? WHERE id=?`).run(now, m.conversationId);
  const r = getDb().prepare(`SELECT * FROM messages WHERE id=?`).get(id);
  return rowToMessage(r);
}

export function listMessages(conversationId: string, limit = 500): Message[] {
  return getDb()
    .prepare(`SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at ASC LIMIT ?`)
    .all(conversationId, limit)
    .map(rowToMessage);
}

export function getMessage(id: string): Message | undefined {
  const r = getDb().prepare(`SELECT * FROM messages WHERE id=?`).get(id);
  return r ? rowToMessage(r) : undefined;
}

export function toggleMessageReaction(id: string, emoji: string): Message | undefined {
  const msg = getMessage(id);
  if (!msg) return undefined;
  const reactions = { ...(msg.reactions ?? {}) };
  if (reactions[emoji]) delete reactions[emoji];
  else reactions[emoji] = 1;
  getDb()
    .prepare(`UPDATE messages SET reactions_json=? WHERE id=?`)
    .run(Object.keys(reactions).length ? JSON.stringify(reactions) : null, id);
  return getMessage(id);
}

export function searchMessages(query: string, limit = 40): SearchHit[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const rows = getDb()
    .prepare(
      `SELECT m.id as message_id, m.text as text, m.created_at as created_at, m.conversation_id as conversation_id, c.title as title, c.kind as kind
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       WHERE (m.text LIKE ? ESCAPE '\\' OR IFNULL(m.attachments_json,'') LIKE ? ESCAPE '\\')
         AND m.sender_kind != 'system'
         AND c.kind != 'agent_dm'
       ORDER BY m.created_at DESC LIMIT ?`,
    )
    .all(like, like, limit) as {
    message_id: string;
    text: string;
    created_at: number;
    conversation_id: string;
    title: string;
    kind: string;
  }[];
  return rows.map((r) => ({
    conversationId: r.conversation_id,
    conversationTitle: r.title,
    messageId: r.message_id,
    text: r.text,
    createdAt: r.created_at,
  }));
}

// ── tasks & steps ───────────────────────────────────────────────────────

export function createTask(agentId: string, conversationId: string, prompt: string): Task {
  const id = nanoid(10);
  getDb()
    .prepare(`INSERT INTO tasks (id, agent_id, conversation_id, prompt, status, step_count, created_at) VALUES (?, ?, ?, ?, 'queued', 0, ?)`)
    .run(id, agentId, conversationId, prompt, Date.now());
  return getTask(id)!;
}

export function getTask(id: string): Task | undefined {
  const r = getDb().prepare(`SELECT * FROM tasks WHERE id=?`).get(id);
  return r ? rowToTask(r) : undefined;
}

export function updateTask(id: string, patch: { status?: TaskStatus; stepCount?: number; resultSummary?: string; finishedAt?: number }): Task | undefined {
  const cur = getTask(id);
  if (!cur) return undefined;
  getDb()
    .prepare(`UPDATE tasks SET status=?, step_count=?, result_summary=?, finished_at=? WHERE id=?`)
    .run(
      patch.status ?? cur.status,
      patch.stepCount ?? cur.stepCount,
      patch.resultSummary ?? cur.resultSummary ?? null,
      patch.finishedAt ?? cur.finishedAt ?? null,
      id,
    );
  return getTask(id);
}

export function addTaskStep(taskId: string, idx: number, caption: string, actionJson?: string, screenshotUrl?: string): void {
  getDb()
    .prepare(`INSERT INTO task_steps (id, task_id, idx, caption, action_json, screenshot_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(nanoid(12), taskId, idx, caption, actionJson ?? null, screenshotUrl ?? null, Date.now());
}

// ── approvals ───────────────────────────────────────────────────────────

export function createApproval(a: {
  taskId: string;
  agentId: string;
  conversationId: string;
  actionDescription: string;
  actionJson: string;
  reason: string;
}): Approval {
  const id = nanoid(10);
  getDb()
    .prepare(
      `INSERT INTO approvals (id, task_id, agent_id, conversation_id, action_description, action_json, reason, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .run(id, a.taskId, a.agentId, a.conversationId, a.actionDescription, a.actionJson, a.reason, Date.now());
  const r = getDb().prepare(`SELECT * FROM approvals WHERE id=?`).get(id);
  return rowToApproval(r);
}

export function getApproval(id: string): Approval | undefined {
  const r = getDb().prepare(`SELECT * FROM approvals WHERE id=?`).get(id);
  return r ? rowToApproval(r) : undefined;
}

export function resolveApproval(id: string, status: "approved" | "rejected"): Approval | undefined {
  getDb().prepare(`UPDATE approvals SET status=? WHERE id=? AND status='pending'`).run(status, id);
  return getApproval(id);
}

export function listApprovalsByConversation(conversationId: string): Approval[] {
  return getDb()
    .prepare(`SELECT * FROM approvals WHERE conversation_id=? ORDER BY created_at ASC`)
    .all(conversationId)
    .map(rowToApproval);
}

export function listPendingApprovalsForAgent(agentId: string): Approval[] {
  return getDb()
    .prepare(`SELECT * FROM approvals WHERE agent_id=? AND status='pending'`)
    .all(agentId)
    .map(rowToApproval);
}

// ── memories ────────────────────────────────────────────────────────────

export function addMemory(agentId: string, kind: MemoryKind, content: string): MemoryEntry {
  const id = nanoid(12);
  getDb().prepare(`INSERT INTO memories (id, agent_id, kind, content, created_at) VALUES (?, ?, ?, ?, ?)`).run(id, agentId, kind, content, Date.now());
  const r = getDb().prepare(`SELECT * FROM memories WHERE id=?`).get(id);
  return rowToMemory(r);
}

export function listMemories(agentId: string, limit = 40): MemoryEntry[] {
  return getDb()
    .prepare(`SELECT * FROM memories WHERE agent_id=? ORDER BY created_at DESC LIMIT ?`)
    .all(agentId, limit)
    .map(rowToMemory);
}

export function deleteMemory(id: string): void {
  getDb().prepare(`DELETE FROM memories WHERE id=?`).run(id);
}

export function listActiveTasksForAgent(agentId: string): Task[] {
  return getDb()
    .prepare(`SELECT * FROM tasks WHERE agent_id=? AND status IN ('queued','running','waiting_approval')`)
    .all(agentId)
    .map(rowToTask);
}

// ── skills ──────────────────────────────────────────────────────────────

function rowToSkill(r: any): Skill {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    createdByAgentId: r.created_by_agent_id ?? undefined,
    createdAt: r.created_at,
  };
}

export function createSkill(input: {
  name: string;
  description: string;
  instructions: string;
  createdByAgentId?: string;
}): Skill {
  const id = nanoid(10);
  getDb()
    .prepare(
      `INSERT INTO skills (id, name, description, instructions, created_by_agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.name.trim(), input.description.trim(), input.instructions.trim(), input.createdByAgentId ?? null, Date.now());
  if (input.createdByAgentId) setAgentSkill(input.createdByAgentId, id, true);
  return getSkill(id)!;
}

export function getSkill(id: string): Skill | undefined {
  const r = getDb().prepare(`SELECT * FROM skills WHERE id=?`).get(id);
  return r ? rowToSkill(r) : undefined;
}

export function getSkillByName(name: string): Skill | undefined {
  const r = getDb().prepare(`SELECT * FROM skills WHERE lower(name)=lower(?)`).get(name.trim());
  return r ? rowToSkill(r) : undefined;
}

export function listSkills(): Skill[] {
  return getDb().prepare(`SELECT * FROM skills ORDER BY name COLLATE NOCASE`).all().map(rowToSkill);
}

export function updateSkill(
  id: string,
  patch: Partial<Pick<Skill, "name" | "description" | "instructions">>,
): Skill | undefined {
  const cur = getSkill(id);
  if (!cur) return undefined;
  getDb()
    .prepare(`UPDATE skills SET name=?, description=?, instructions=? WHERE id=?`)
    .run(patch.name ?? cur.name, patch.description ?? cur.description, patch.instructions ?? cur.instructions, id);
  return getSkill(id);
}

export function deleteSkill(id: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM agent_skills WHERE skill_id=?`).run(id);
  db.prepare(`UPDATE routines SET skill_id=NULL WHERE skill_id=?`).run(id);
  db.prepare(`DELETE FROM skills WHERE id=?`).run(id);
}

export function setAgentSkill(agentId: string, skillId: string, enabled: boolean): void {
  getDb()
    .prepare(
      `INSERT INTO agent_skills (agent_id, skill_id, enabled) VALUES (?, ?, ?)
       ON CONFLICT(agent_id, skill_id) DO UPDATE SET enabled=excluded.enabled`,
    )
    .run(agentId, skillId, enabled ? 1 : 0);
}

export function listEnabledSkillsForAgent(agentId: string): Skill[] {
  return getDb()
    .prepare(
      `SELECT s.* FROM skills s
       JOIN agent_skills a ON a.skill_id=s.id
       WHERE a.agent_id=? AND a.enabled=1
       ORDER BY s.name COLLATE NOCASE`,
    )
    .all(agentId)
    .map(rowToSkill);
}

export function agentHasSkill(agentId: string, skillId: string): boolean {
  const r = getDb()
    .prepare(`SELECT 1 FROM agent_skills WHERE agent_id=? AND skill_id=? AND enabled=1`)
    .get(agentId, skillId);
  return !!r;
}

export function copyAgentSkills(fromAgentId: string, toAgentId: string): void {
  const rows = getDb()
    .prepare(`SELECT skill_id, enabled FROM agent_skills WHERE agent_id=?`)
    .all(fromAgentId) as { skill_id: string; enabled: number }[];
  for (const row of rows) setAgentSkill(toAgentId, row.skill_id, !!row.enabled);
}

/** Official duplicate copies enabled skills and routines, not history or memory. */
export function copyAgentRoutines(fromAgentId: string, toAgentId: string): void {
  for (const routine of listRoutines(fromAgentId)) {
    const copy = createRoutine({
      agentId: toAgentId,
      skillId: routine.skillId,
      name: routine.name,
      prompt: routine.prompt,
      intervalMinutes: routine.intervalMinutes,
      schedule: routine.schedule,
      timezone: routine.timezone,
    });
    if (!routine.enabled) updateRoutine(copy.id, { enabled: false });
  }
}

// ── routines ────────────────────────────────────────────────────────────

function parseStoredSchedule(raw: unknown, intervalMinutes: number): RoutineSchedule {
  if (typeof raw === "string" && raw.trim()) {
    try {
      return JSON.parse(raw) as RoutineSchedule;
    } catch {
      /* fall through */
    }
  }
  return { kind: "interval", everyMinutes: intervalMinutes || 60 };
}

function rowToRoutine(r: any): Routine {
  const schedule = parseStoredSchedule(r.schedule_json, r.interval_minutes);
  return {
    id: r.id,
    agentId: r.agent_id,
    skillId: r.skill_id ?? undefined,
    name: r.name,
    prompt: r.prompt,
    intervalMinutes: r.interval_minutes,
    schedule,
    scheduleLabel: formatSchedule(schedule),
    timezone: r.timezone || config.browserTimezone,
    enabled: !!r.enabled,
    nextRunAt: r.next_run_at,
    lastRunAt: r.last_run_at ?? undefined,
    lastStatus: r.last_status ?? undefined,
    createdAt: r.created_at,
  };
}

export function resolveRoutineSchedule(input: {
  schedule?: RoutineSchedule | string;
  intervalMinutes?: number;
  now?: number;
  timeZone?: string;
}): { schedule: RoutineSchedule; timezone: string; nextRunAt: number; intervalMinutes: number } {
  const timezone = input.timeZone || config.browserTimezone;
  const now = input.now ?? Date.now();
  let schedule: RoutineSchedule | undefined;
  if (typeof input.schedule === "string") schedule = parseSchedule(input.schedule);
  else if (input.schedule) schedule = input.schedule;
  if (!schedule && input.intervalMinutes) {
    schedule = { kind: "interval", everyMinutes: Math.max(1, Math.round(input.intervalMinutes)) };
  }
  if (!schedule) throw new Error('Need a schedule like "every morning" or "every 30 minutes until 4 AM"');
  schedule = withWindowStart(schedule, now, timezone);
  return {
    schedule,
    timezone,
    nextRunAt: nextRunAt(schedule, now, timezone),
    intervalMinutes: intervalMinutesOf(schedule),
  };
}

export function createRoutine(input: {
  agentId: string;
  skillId?: string;
  name: string;
  prompt: string;
  intervalMinutes?: number;
  schedule?: RoutineSchedule | string;
  timezone?: string;
}): Routine {
  const id = nanoid(10);
  const now = Date.now();
  const resolved = resolveRoutineSchedule({
    schedule: input.schedule,
    intervalMinutes: input.intervalMinutes,
    now,
    timeZone: input.timezone,
  });
  getDb()
    .prepare(
      `INSERT INTO routines (id, agent_id, skill_id, name, prompt, interval_minutes, schedule_json, timezone, enabled, next_run_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .run(
      id,
      input.agentId,
      input.skillId ?? null,
      input.name.trim(),
      input.prompt.trim(),
      resolved.intervalMinutes,
      JSON.stringify(resolved.schedule),
      resolved.timezone,
      resolved.nextRunAt,
      now,
    );
  return getRoutine(id)!;
}

export function getRoutine(id: string): Routine | undefined {
  const r = getDb().prepare(`SELECT * FROM routines WHERE id=?`).get(id);
  return r ? rowToRoutine(r) : undefined;
}

export function listRoutines(agentId?: string): Routine[] {
  if (agentId) {
    return getDb().prepare(`SELECT * FROM routines WHERE agent_id=? ORDER BY name COLLATE NOCASE`).all(agentId).map(rowToRoutine);
  }
  return getDb().prepare(`SELECT * FROM routines ORDER BY name COLLATE NOCASE`).all().map(rowToRoutine);
}

export function updateRoutine(
  id: string,
  patch: Partial<Pick<Routine, "name" | "prompt" | "intervalMinutes" | "enabled" | "skillId" | "nextRunAt" | "lastRunAt" | "lastStatus" | "timezone">> & {
    schedule?: RoutineSchedule | string;
  },
): Routine | undefined {
  const cur = getRoutine(id);
  if (!cur) return undefined;
  let schedule = cur.schedule ?? { kind: "interval" as const, everyMinutes: cur.intervalMinutes };
  let timezone = patch.timezone ?? cur.timezone;
  let next = patch.nextRunAt ?? cur.nextRunAt;
  if (patch.schedule !== undefined || patch.intervalMinutes !== undefined) {
    const resolved = resolveRoutineSchedule({
      schedule: patch.schedule ?? schedule,
      intervalMinutes: patch.intervalMinutes,
      now: Date.now(),
      timeZone: timezone,
    });
    schedule = resolved.schedule;
    timezone = resolved.timezone;
    next = resolved.nextRunAt;
  }
  getDb()
    .prepare(
      `UPDATE routines SET name=?, prompt=?, interval_minutes=?, schedule_json=?, timezone=?, enabled=?, skill_id=?, next_run_at=?, last_run_at=?, last_status=? WHERE id=?`,
    )
    .run(
      patch.name ?? cur.name,
      patch.prompt ?? cur.prompt,
      intervalMinutesOf(schedule),
      JSON.stringify(schedule),
      timezone,
      (patch.enabled ?? cur.enabled) ? 1 : 0,
      patch.skillId === undefined ? (cur.skillId ?? null) : patch.skillId,
      next,
      patch.lastRunAt ?? cur.lastRunAt ?? null,
      patch.lastStatus ?? cur.lastStatus ?? null,
      id,
    );
  return getRoutine(id);
}

export function deleteRoutine(id: string): void {
  getDb().prepare(`DELETE FROM routines WHERE id=?`).run(id);
}

export function listDueRoutines(now: number): Routine[] {
  return getDb()
    .prepare(`SELECT * FROM routines WHERE enabled=1 AND next_run_at<=?`)
    .all(now)
    .map(rowToRoutine);
}

export function markRoutineRan(id: string, status: "ok" | "failed" | "running"): Routine | undefined {
  const cur = getRoutine(id);
  if (!cur) return undefined;
  const now = Date.now();
  const schedule = cur.schedule ?? { kind: "interval" as const, everyMinutes: cur.intervalMinutes };
  return updateRoutine(id, {
    lastRunAt: now,
    lastStatus: status,
    nextRunAt: nextRunAt(schedule, now, cur.timezone || config.browserTimezone),
  });
}

// ── plugins / connectors ────────────────────────────────────────────────

function rowToPlugin(r: any): Plugin {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as PluginKind,
    enabled: !!r.enabled,
    command: r.command ?? undefined,
    args: parseJson<string[]>(r.args_json, []),
    env: parseJson<Record<string, string>>(r.env_json, {}),
    url: r.url ?? undefined,
    createdAt: r.created_at,
  };
}

export function createPlugin(input: {
  name: string;
  kind: PluginKind;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}): Plugin {
  const id = nanoid(10);
  getDb()
    .prepare(
      `INSERT INTO plugins (id, name, kind, enabled, command, args_json, env_json, url, created_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name.trim(),
      input.kind,
      input.command?.trim() || null,
      JSON.stringify(input.args ?? []),
      JSON.stringify(input.env ?? {}),
      input.url?.trim() || null,
      Date.now(),
    );
  return getPlugin(id)!;
}

export function getPlugin(id: string): Plugin | undefined {
  const r = getDb().prepare(`SELECT * FROM plugins WHERE id=?`).get(id);
  return r ? rowToPlugin(r) : undefined;
}

export function listPlugins(): Plugin[] {
  return getDb().prepare(`SELECT * FROM plugins ORDER BY created_at ASC`).all().map(rowToPlugin);
}

export function updatePlugin(id: string, patch: Partial<Pick<Plugin, "name" | "enabled" | "command" | "args" | "env" | "url">>): Plugin | undefined {
  const cur = getPlugin(id);
  if (!cur) return undefined;
  getDb()
    .prepare(`UPDATE plugins SET name=?, enabled=?, command=?, args_json=?, env_json=?, url=? WHERE id=?`)
    .run(
      patch.name ?? cur.name,
      (patch.enabled ?? cur.enabled) ? 1 : 0,
      (patch.command ?? cur.command) || null,
      JSON.stringify(patch.args ?? cur.args),
      JSON.stringify(patch.env ?? cur.env),
      (patch.url ?? cur.url) || null,
      id,
    );
  return getPlugin(id);
}

export function deletePlugin(id: string): void {
  getDb().prepare(`DELETE FROM plugins WHERE id=?`).run(id);
}

// ── delegations (hierarchical multi-agent) ────────────────────────────────

function rowToDelegation(r: any): Delegation {
  return {
    id: r.id,
    rootMessageId: r.root_message_id ?? undefined,
    parentAgentId: r.parent_agent_id,
    childAgentId: r.child_agent_id,
    conversationId: r.conversation_id ?? undefined,
    childTaskId: r.child_task_id ?? undefined,
    goal: r.goal,
    role: (r.role as Delegation["role"]) || "leaf",
    depth: r.depth ?? 1,
    status: (r.status as Delegation["status"]) || "running",
    resultSummary: r.result_summary ?? undefined,
    stepCount: r.step_count ?? undefined,
    createdAt: r.created_at,
    finishedAt: r.finished_at ?? undefined,
  };
}

export function createDelegation(input: {
  rootMessageId?: string;
  parentAgentId: string;
  childAgentId: string;
  conversationId?: string;
  goal: string;
  role: Delegation["role"];
  depth: number;
}): Delegation {
  const id = nanoid(10);
  getDb()
    .prepare(
      `INSERT INTO delegations (id, root_message_id, parent_agent_id, child_agent_id, conversation_id, goal, role, depth, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
    )
    .run(
      id,
      input.rootMessageId ?? null,
      input.parentAgentId,
      input.childAgentId,
      input.conversationId ?? null,
      input.goal,
      input.role,
      input.depth,
      Date.now(),
    );
  return getDelegation(id)!;
}

export function getDelegation(id: string): Delegation | undefined {
  const r = getDb().prepare(`SELECT * FROM delegations WHERE id=?`).get(id);
  return r ? rowToDelegation(r) : undefined;
}

export function updateDelegation(
  id: string,
  patch: Partial<Pick<Delegation, "childTaskId" | "status" | "resultSummary" | "stepCount" | "finishedAt">>,
): Delegation | undefined {
  const cur = getDelegation(id);
  if (!cur) return undefined;
  getDb()
    .prepare(
      `UPDATE delegations SET child_task_id=?, status=?, result_summary=?, step_count=?, finished_at=? WHERE id=?`,
    )
    .run(
      patch.childTaskId ?? cur.childTaskId ?? null,
      patch.status ?? cur.status,
      patch.resultSummary ?? cur.resultSummary ?? null,
      patch.stepCount ?? cur.stepCount ?? null,
      patch.finishedAt ?? cur.finishedAt ?? null,
      id,
    );
  return getDelegation(id);
}

export function listDelegationsByParent(parentAgentId: string): Delegation[] {
  return getDb()
    .prepare(`SELECT * FROM delegations WHERE parent_agent_id=? ORDER BY created_at ASC`)
    .all(parentAgentId)
    .map(rowToDelegation);
}

export function listDelegationsForRoot(rootMessageId: string): Delegation[] {
  return getDb()
    .prepare(`SELECT * FROM delegations WHERE root_message_id=? ORDER BY created_at ASC`)
    .all(rootMessageId)
    .map(rowToDelegation);
}

export function listActiveDelegationsForChild(childAgentId: string): Delegation[] {
  return getDb()
    .prepare(`SELECT * FROM delegations WHERE child_agent_id=? AND status='running' ORDER BY created_at ASC`)
    .all(childAgentId)
    .map(rowToDelegation);
}
