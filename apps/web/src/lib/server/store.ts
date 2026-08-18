import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  AppState,
  Approval,
  AuditEvent,
  Bot,
  ChatMessage,
  Settings,
  Skill,
  Thread,
  WorkstationState,
} from "../types";
import { BOT_COLORS } from "../types";
import { initialsFromName } from "../logic";
import { createWorkstation } from "./workstation";

const DATA_DIR = process.env.FORGE_DATA_DIR || path.join(process.cwd(), "data");
const STATE_PATH = path.join(DATA_DIR, "forge.json");

let cache: AppState | null = null;
let writeChain: Promise<void> = Promise.resolve();

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function seed(): AppState {
  const createdAt = now();
  const atlas = makeBot({
    name: "Atlas",
    title: "Chief of Staff",
    description:
      "Coordinate other Bots only when the user asks. Own the digest of what changed and what needs a decision. Never send messages or change systems without approval.",
    color: BOT_COLORS[0],
    provider: "rehearsal",
    model: "rehearsal",
  });
  const scout = makeBot({
    name: "Scout",
    title: "Researcher",
    description:
      "Gather sources, link every claim, and separate facts from guesses. Do not contact anyone. Prefer the workstation browser and notes in Home.",
    color: BOT_COLORS[1],
    provider: "rehearsal",
    model: "rehearsal",
  });
  const piper = makeBot({
    name: "Piper",
    title: "Writer",
    description:
      "Turn research into a tight draft in the user's voice. Do not publish. Ask before sending anything outside this workspace.",
    color: BOT_COLORS[2],
    provider: "rehearsal",
    model: "rehearsal",
  });

  const bots = [atlas, scout, piper];
  const threads: Thread[] = bots.map((bot) => ({
    id: id("thr"),
    kind: "dm",
    title: bot.name,
    botIds: [bot.id],
    allowCollaboration: false,
    createdAt,
    updatedAt: createdAt,
    unread: false,
  }));

  const workstations: Record<string, WorkstationState> = {};
  for (const bot of bots) {
    workstations[bot.id] = createWorkstation(bot, DATA_DIR);
  }

  return {
    bots,
    threads,
    messages: [
      {
        id: id("msg"),
        threadId: threads[0].id,
        role: "system",
        content:
          "Forge is ready. Each Bot has its own OS. Atlas can talk to the others only when you ask. Add an API key in Settings to leave rehearsal mode.",
        createdAt,
      },
    ],
    skills: [
      {
        id: id("skl"),
        name: "Source-linked brief",
        body: "When asked for a brief: 1) list facts with links, 2) list assumptions separately, 3) list decisions needed, 4) do not send or publish.",
        createdAt,
      },
    ],
    approvals: [],
    audit: [],
    settings: { providers: {}, timezone: "UTC" },
    workstations,
  };
}

export function makeBot(input: {
  name: string;
  title: string;
  description: string;
  color?: string;
  provider?: Bot["provider"];
  model?: string;
}): Bot {
  const createdAt = now();
  return {
    id: id("bot"),
    name: input.name.trim(),
    title: input.title.trim(),
    description: input.description.trim(),
    color: input.color || BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)],
    initials: initialsFromName(input.name),
    provider: input.provider || "rehearsal",
    model: input.model || "rehearsal",
    allowCollaboration: true,
    hidden: false,
    pinned: false,
    createdAt,
    updatedAt: createdAt,
    status: "idle",
    memory: [],
  };
}

function ensureLoaded(): AppState {
  if (cache) return cache;
  mkdirSync(DATA_DIR, { recursive: true });
  try {
    cache = JSON.parse(readFileSync(STATE_PATH, "utf8")) as AppState;
  } catch {
    cache = seed();
    persistSync(cache);
  }
  return cache;
}

function persistSync(state: AppState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_PATH);
}

function persist(state: AppState): Promise<void> {
  writeChain = writeChain.then(() => persistSync(state));
  return writeChain;
}

export function dataDir(): string {
  ensureLoaded();
  return DATA_DIR;
}

export function getState(): AppState {
  return ensureLoaded();
}

export async function updateState(
  mutator: (state: AppState) => void,
): Promise<AppState> {
  const state = ensureLoaded();
  mutator(state);
  await persist(state);
  return state;
}

export function listBots(includeHidden = false): Bot[] {
  return getState()
    .bots.filter((bot) => includeHidden || !bot.hidden)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
}

export function getBot(botId: string): Bot | undefined {
  return getState().bots.find((bot) => bot.id === botId);
}

export async function upsertBot(bot: Bot): Promise<Bot> {
  await updateState((state) => {
    const index = state.bots.findIndex((item) => item.id === bot.id);
    bot.updatedAt = now();
    if (index === -1) {
      state.bots.push(bot);
      state.threads.push({
        id: id("thr"),
        kind: "dm",
        title: bot.name,
        botIds: [bot.id],
        allowCollaboration: false,
        createdAt: bot.createdAt,
        updatedAt: bot.updatedAt,
        unread: false,
      });
      if (!state.workstations[bot.id]) {
        state.workstations[bot.id] = createWorkstation(bot, DATA_DIR);
      }
    } else {
      state.bots[index] = bot;
      for (const thread of state.threads) {
        if (thread.kind === "dm" && thread.botIds[0] === bot.id) {
          thread.title = bot.name;
        }
      }
    }
  });
  return getBot(bot.id)!;
}

export function listThreads(): Thread[] {
  return [...getState().threads].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

export function getThread(threadId: string): Thread | undefined {
  return getState().threads.find((thread) => thread.id === threadId);
}

export function threadForBot(botId: string): Thread | undefined {
  return getState().threads.find(
    (thread) => thread.kind === "dm" && thread.botIds[0] === botId,
  );
}

export async function createGroup(botIds: string[], title?: string): Promise<Thread> {
  const bots = botIds
    .map((botId) => getBot(botId))
    .filter((bot): bot is Bot => Boolean(bot));
  if (bots.length < 2 || bots.length > 6) {
    throw new Error("A group needs 2 to 6 Bots");
  }
  const thread: Thread = {
    id: id("thr"),
    kind: "group",
    title: title?.trim() || bots.map((bot) => bot.name).join(", "),
    botIds: bots.map((bot) => bot.id),
    allowCollaboration: true,
    createdAt: now(),
    updatedAt: now(),
    unread: false,
  };
  await updateState((state) => {
    state.threads.unshift(thread);
  });
  return thread;
}

export function messagesFor(threadId: string): ChatMessage[] {
  return getState()
    .messages.filter((message) => message.threadId === threadId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function addMessage(
  input: Omit<ChatMessage, "id" | "createdAt"> & { id?: string; createdAt?: string },
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: input.id || id("msg"),
    createdAt: input.createdAt || now(),
    threadId: input.threadId,
    role: input.role,
    botId: input.botId,
    content: input.content,
    meta: input.meta,
  };
  await updateState((state) => {
    state.messages.push(message);
    const thread = state.threads.find((item) => item.id === input.threadId);
    if (thread) {
      thread.updatedAt = message.createdAt;
      thread.unread = input.role !== "user";
    }
  });
  return message;
}

export function listSkills(): Skill[] {
  return getState().skills;
}

export async function addSkill(name: string, body: string): Promise<Skill> {
  const skill: Skill = {
    id: id("skl"),
    name: name.trim(),
    body: body.trim(),
    createdAt: now(),
  };
  await updateState((state) => {
    state.skills.push(skill);
  });
  return skill;
}

export function listApprovals(status?: Approval["status"]): Approval[] {
  return getState().approvals.filter((item) =>
    status ? item.status === status : true,
  );
}

export async function addApproval(
  input: Omit<Approval, "id" | "createdAt" | "status">,
): Promise<Approval> {
  const approval: Approval = {
    ...input,
    id: id("apr"),
    status: "pending",
    createdAt: now(),
  };
  await updateState((state) => {
    state.approvals.push(approval);
    const bot = state.bots.find((item) => item.id === input.botId);
    if (bot) bot.status = "needs_attention";
  });
  return approval;
}

export async function resolveApproval(
  approvalId: string,
  status: "approved" | "denied",
): Promise<Approval | undefined> {
  let resolved: Approval | undefined;
  await updateState((state) => {
    const approval = state.approvals.find((item) => item.id === approvalId);
    if (!approval) return;
    approval.status = status;
    approval.resolvedAt = now();
    resolved = approval;
    const bot = state.bots.find((item) => item.id === approval.botId);
    if (bot) bot.status = "idle";
  });
  return resolved;
}

export async function addAudit(event: Omit<AuditEvent, "id" | "createdAt">): Promise<void> {
  await updateState((state) => {
    state.audit.unshift({
      ...event,
      id: id("aud"),
      createdAt: now(),
    });
    state.audit = state.audit.slice(0, 500);
  });
}

export function getSettings(): Settings {
  return getState().settings;
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  await updateState((state) => {
    state.settings = settings;
  });
  return getSettings();
}

export function getWorkstation(botId: string): WorkstationState | undefined {
  return getState().workstations[botId];
}

export async function saveWorkstation(next: WorkstationState): Promise<void> {
  await updateState((state) => {
    state.workstations[next.botId] = next;
  });
}

export async function setBotStatus(botId: string, status: Bot["status"]): Promise<void> {
  await updateState((state) => {
    const bot = state.bots.find((item) => item.id === botId);
    if (bot) bot.status = status;
  });
}

export function snapshot() {
  const state = getState();
  return {
    bots: listBots(true),
    threads: listThreads(),
    skills: state.skills,
    approvals: state.approvals,
    settings: {
      timezone: state.settings.timezone,
      providers: Object.fromEntries(
        Object.entries(state.settings.providers).map(([key, value]) => [
          key,
          { hasKey: Boolean(value?.apiKey), baseUrl: value?.baseUrl || "" },
        ]),
      ),
    },
    audit: state.audit.slice(0, 40),
  };
}
