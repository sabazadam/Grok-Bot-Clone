/** SQLite persistence (better-sqlite3, WAL). Plain SQL with typed mappers. */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { config } from "./config.js";

const DDL = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  avatar_color TEXT NOT NULL DEFAULT '#6366f1',
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  collaboration_enabled INTEGER NOT NULL DEFAULT 1,
  stealth_browsing INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 0,
  is_team_lead INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'off',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  agent_ids TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_kind TEXT NOT NULL,
  sender_agent_id TEXT,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  approval_id TEXT,
  screenshot_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL,
  step_count INTEGER NOT NULL DEFAULT 0,
  result_summary TEXT,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS task_steps (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  caption TEXT NOT NULL,
  action_json TEXT,
  screenshot_url TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_steps_task ON task_steps(task_id, idx);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  action_description TEXT NOT NULL,
  action_json TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL,
  created_by_agent_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (agent_id, skill_id)
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  skill_id TEXT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  interval_minutes INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_status TEXT,
  created_at INTEGER NOT NULL
);
`;

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    db = new Database(path.join(config.dataDir, "grokbot.db"));
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(DDL);
    migrate(db);
  }
  return db;
}

/** Additive column migrations for databases created before newer features. */
function migrate(d: Database.Database): void {
  const cols = new Set((d.prepare(`PRAGMA table_info(agents)`).all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("stealth_browsing")) {
    d.exec(`ALTER TABLE agents ADD COLUMN stealth_browsing INTEGER NOT NULL DEFAULT 1`);
  }
  if (!cols.has("hidden")) {
    d.exec(`ALTER TABLE agents ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.has("is_team_lead")) {
    d.exec(`ALTER TABLE agents ADD COLUMN is_team_lead INTEGER NOT NULL DEFAULT 0`);
  }
}

/** For tests: use an isolated in-memory database. */
export function useTestDb(): Database.Database {
  db = new Database(":memory:");
  db.exec(DDL);
  migrate(db);
  return db;
}
