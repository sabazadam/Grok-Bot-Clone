/** Typed repository over SQLite rows <-> shared entities. */
import { nanoid } from "nanoid";
import type {
  Agent,
  AgentStatus,
  Approval,
  ApprovalStatus,
  Conversation,
  ConversationKind,
  MemoryEntry,
  MemoryKind,
  Message,
  MessageKind,
  MessageSender,
  Provider,
  Routine,
  RoutineSchedule,
  Skill,
  Task,
  TaskStatus,
} from "@grokbot/shared";
import { formatSchedule, intervalMinutesOf, nextRunAt, parseSchedule, withWindowStart } from "@grokbot/shared";
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
    provider: r.provider as Provider,
    model: r.model,
    collaborationEnabled: !!r.collaboration_enabled,
    stealthBrowsing: !!r.stealth_browsing,
    hidden: !!r.hidden,
    isTeamLead: !!r.is_team_lead,
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
    createdAt: r.created_at,
  };
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
  provider: Provider;
  model: string;
  collaborationEnabled: boolean;
  stealthBrowsing: boolean;
  isTeamLead?: boolean;
}

export function createAgent(a: NewAgent): Agent {
  const id = nanoid(10);
  getDb()
    .prepare(
      `INSERT INTO agents (id, name, role_title, instructions, avatar_color, provider, model, collaboration_enabled, stealth_browsing, hidden, is_team_lead, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'off', ?)`,
    )
    .run(
      id,
      a.name,
      a.roleTitle,
      a.instructions,
      a.avatarColor,
      a.provider,
      a.model,
      a.collaborationEnabled ? 1 : 0,
      a.stealthBrowsing ? 1 : 0,
      a.isTeamLead ? 1 : 0,
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

export function updateAgent(id: string, patch: Partial<NewAgent>): Agent | undefined {
  const cur = getAgent(id);
  if (!cur) return undefined;
  const merged = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE agents SET name=?, role_title=?, instructions=?, avatar_color=?, provider=?, model=?, collaboration_enabled=?, stealth_browsing=?, is_team_lead=? WHERE id=?`,
    )
    .run(
      merged.name,
      merged.roleTitle,
      merged.instructions,
      merged.avatarColor,
      merged.provider,
      merged.model,
      merged.collaborationEnabled ? 1 : 0,
      merged.stealthBrowsing ? 1 : 0,
      merged.isTeamLead ? 1 : 0,
      id,
    );
  return getAgent(id);
}

export function setAgentStatus(id: string, status: AgentStatus): void {
  getDb().prepare(`UPDATE agents SET status=? WHERE id=?`).run(status, id);
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
  return getDb().prepare(`SELECT * FROM conversations ORDER BY last_message_at DESC`).all().map(rowToConversation);
}

/** The 1:1 user<->agent conversation (created on agent creation). */
export function directConversationForAgent(agentId: string): Conversation | undefined {
  return listConversations().find((c) => c.kind === "direct" && c.agentIds.length === 1 && c.agentIds[0] === agentId);
}

/** The agent's own chat, created if missing. Agent-to-agent delegation lands here. */
export function ensureDirectConversation(agentId: string): Conversation {
  const existing = directConversationForAgent(agentId);
  if (existing) return existing;
  const name = getAgent(agentId)?.name ?? "Agent";
  return createConversation("direct", name, [agentId]);
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
}

export function addMessage(m: NewMessage): Message {
  const id = nanoid(12);
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO messages (id, conversation_id, sender_kind, sender_agent_id, kind, text, approval_id, screenshot_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
