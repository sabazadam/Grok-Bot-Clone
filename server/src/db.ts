import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Agent, AgentRow, Message, MessageRole } from './types.js';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.BOTBOX_DATA_DIR ?? join(here, '..', 'data');
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, 'botbox.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#7c5cff',
  status TEXT NOT NULL DEFAULT 'idle',
  computer_state TEXT NOT NULL DEFAULT 'stopped',
  memory TEXT NOT NULL DEFAULT '',
  container_id TEXT,
  action_port INTEGER,
  vnc_port INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  sender_agent_id TEXT,
  sender_name TEXT,
  meta TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id, created_at);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

// ---------- agents ----------

interface RawAgentRow {
  id: string;
  name: string;
  title: string;
  description: string;
  provider: string;
  model: string;
  color: string;
  status: string;
  computer_state: string;
  memory: string;
  container_id: string | null;
  action_port: number | null;
  vnc_port: number | null;
  created_at: string;
}

function toAgentRow(r: RawAgentRow): AgentRow {
  return {
    id: r.id,
    name: r.name,
    title: r.title,
    description: r.description,
    provider: r.provider,
    model: r.model,
    color: r.color,
    status: r.status as AgentRow['status'],
    computerState: r.computer_state as AgentRow['computerState'],
    memory: r.memory,
    containerId: r.container_id,
    actionPort: r.action_port,
    vncPort: r.vnc_port,
    createdAt: r.created_at,
  };
}

export function toPublicAgent(row: AgentRow): Agent {
  const { containerId: _c, actionPort: _a, vncPort: _v, ...pub } = row;
  return pub;
}

export function listAgents(): AgentRow[] {
  const rows = db.prepare('SELECT * FROM agents ORDER BY created_at').all() as RawAgentRow[];
  return rows.map(toAgentRow);
}

export function getAgent(id: string): AgentRow | undefined {
  const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as RawAgentRow | undefined;
  return row ? toAgentRow(row) : undefined;
}

export function findAgentByName(name: string): AgentRow | undefined {
  const row = db
    .prepare('SELECT * FROM agents WHERE lower(name) = lower(?)')
    .get(name.trim()) as RawAgentRow | undefined;
  return row ? toAgentRow(row) : undefined;
}

export function insertAgent(a: {
  name: string;
  title: string;
  description: string;
  provider: string;
  model: string;
  color: string;
}): AgentRow {
  const id = newId('agt');
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO agents (id, name, title, description, provider, model, color, status, computer_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', 'stopped', ?)`,
  ).run(id, a.name, a.title, a.description, a.provider, a.model, a.color, createdAt);
  return getAgent(id)!;
}

export function updateAgent(
  id: string,
  fields: Partial<
    Pick<AgentRow, 'name' | 'title' | 'description' | 'provider' | 'model' | 'color' | 'memory'>
  > & {
    status?: AgentRow['status'];
    computerState?: AgentRow['computerState'];
    containerId?: string | null;
    actionPort?: number | null;
    vncPort?: number | null;
  },
): AgentRow | undefined {
  const mapping: Record<string, string> = {
    name: 'name',
    title: 'title',
    description: 'description',
    provider: 'provider',
    model: 'model',
    color: 'color',
    memory: 'memory',
    status: 'status',
    computerState: 'computer_state',
    containerId: 'container_id',
    actionPort: 'action_port',
    vncPort: 'vnc_port',
  };
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(mapping)) {
    if (key in fields) {
      sets.push(`${col} = ?`);
      values.push((fields as Record<string, unknown>)[key] ?? null);
    }
  }
  if (sets.length > 0) {
    db.prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`).run(...values, id);
  }
  return getAgent(id);
}

export function deleteAgent(id: string): void {
  db.prepare('DELETE FROM messages WHERE agent_id = ?').run(id);
  db.prepare('DELETE FROM agents WHERE id = ?').run(id);
}

// ---------- messages ----------

interface RawMessageRow {
  id: string;
  agent_id: string;
  role: string;
  content: string;
  sender_agent_id: string | null;
  sender_name: string | null;
  meta: string | null;
  created_at: string;
}

function toMessage(r: RawMessageRow): Message {
  return {
    id: r.id,
    agentId: r.agent_id,
    role: r.role as MessageRole,
    content: r.content,
    senderAgentId: r.sender_agent_id ?? undefined,
    senderName: r.sender_name ?? undefined,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : undefined,
    createdAt: r.created_at,
  };
}

export function insertMessage(m: {
  agentId: string;
  role: MessageRole;
  content: string;
  senderAgentId?: string;
  senderName?: string;
  meta?: Record<string, unknown>;
}): Message {
  const id = newId('msg');
  const createdAt = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages (id, agent_id, role, content, sender_agent_id, sender_name, meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    m.agentId,
    m.role,
    m.content,
    m.senderAgentId ?? null,
    m.senderName ?? null,
    m.meta ? JSON.stringify(m.meta) : null,
    createdAt,
  );
  return {
    id,
    agentId: m.agentId,
    role: m.role,
    content: m.content,
    senderAgentId: m.senderAgentId,
    senderName: m.senderName,
    meta: m.meta,
    createdAt,
  };
}

export function listMessages(agentId: string, limit = 200): Message[] {
  const rows = db
    .prepare(
      `SELECT * FROM (
         SELECT * FROM messages WHERE agent_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
       ) ORDER BY created_at ASC, id ASC`,
    )
    .all(agentId, limit) as RawMessageRow[];
  return rows.map(toMessage);
}

// ---------- settings ----------

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  if (value === '') {
    db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  } else {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value);
  }
}
