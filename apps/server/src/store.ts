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
  Task,
  TaskStatus,
} from "@grokbot/shared";
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
}

export function createAgent(a: NewAgent): Agent {
  const id = nanoid(10);
  getDb()
    .prepare(
      `INSERT INTO agents (id, name, role_title, instructions, avatar_color, provider, model, collaboration_enabled, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'off', ?)`,
    )
    .run(id, a.name, a.roleTitle, a.instructions, a.avatarColor, a.provider, a.model, a.collaborationEnabled ? 1 : 0, Date.now());
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
      `UPDATE agents SET name=?, role_title=?, instructions=?, avatar_color=?, provider=?, model=?, collaboration_enabled=? WHERE id=?`,
    )
    .run(
      merged.name,
      merged.roleTitle,
      merged.instructions,
      merged.avatarColor,
      merged.provider,
      merged.model,
      merged.collaborationEnabled ? 1 : 0,
      id,
    );
  return getAgent(id);
}

export function setAgentStatus(id: string, status: AgentStatus): void {
  getDb().prepare(`UPDATE agents SET status=? WHERE id=?`).run(status, id);
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

/** Agent<->agent DM channel; created lazily on first inter-agent message. */
export function agentDmConversation(a: string, b: string): Conversation {
  const found = listConversations().find(
    (c) => c.kind === "agent_dm" && c.agentIds.length === 2 && c.agentIds.includes(a) && c.agentIds.includes(b),
  );
  if (found) return found;
  const an = getAgent(a)?.name ?? a;
  const bn = getAgent(b)?.name ?? b;
  return createConversation("agent_dm", `${an} ↔ ${bn}`, [a, b]);
}

export function renameConversation(id: string, title: string): void {
  getDb().prepare(`UPDATE conversations SET title=? WHERE id=?`).run(title, id);
}

export function deleteConversation(id: string): void {
  getDb().prepare(`DELETE FROM messages WHERE conversation_id=?`).run(id);
  getDb().prepare(`DELETE FROM conversations WHERE id=?`).run(id);
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
