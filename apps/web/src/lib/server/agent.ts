import type { Bot, ChatMessage, Thread } from "../types";
import {
  collaborationRequested,
  looksLikeHardStop,
  resolveMentionedBots,
} from "../logic";
import {
  addApproval,
  addAudit,
  addMessage,
  dataDir,
  getBot,
  getSettings,
  getState,
  getThread,
  getWorkstation,
  listBots,
  listSkills,
  saveWorkstation,
  setBotStatus,
  threadForBot,
  updateState,
} from "./store";
import type { ChatTurn, ToolCall } from "./models";
import { completeModel } from "./models";
import {
  browse,
  captionFor,
  clickDesktop,
  moveMouse,
  openApp,
  readHomeFile,
  runShell,
  typeText,
  writeHomeFile,
} from "./workstation";

export interface TurnEvent {
  type: "message" | "computer" | "approval" | "handoff" | "error" | "done";
  payload: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function systemPrompt(bot: Bot, thread: Thread, caption: string): string {
  const skills = listSkills()
    .map((skill) => `### ${skill.name}\n${skill.body}`)
    .join("\n\n");
  const memory = bot.memory.map((note) => `- ${note.text}`).join("\n") || "(none)";
  const peers = listBots()
    .filter((item) => item.id !== bot.id)
    .map((item) => `${item.name} — ${item.title}`)
    .join("\n");
  return [
    `You are ${bot.name}, a persistent teammate.`,
    `Role: ${bot.title}`,
    `Standing rules:\n${bot.description}`,
    `You have your own isolated OS. Do not assume other Bots can see your files or logins.`,
    `Talk to other Bots only if the user asked, this is a group, or allowCollaboration is on.`,
    `Collaboration allowed on this thread: ${thread.allowCollaboration || thread.kind === "group"}`,
    `Never send, publish, purchase, or delete outside your home without request_approval.`,
    `Memories:\n${memory}`,
    `Peers:\n${peers}`,
    skills ? `Skills:\n${skills}` : "",
    `Current desktop:\n${caption}`,
    `Be concise. Work in the OS when the task needs it. Cite sources when you browse.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function emitMessage(
  emit: (event: TurnEvent) => void,
  message: ChatMessage,
): Promise<void> {
  emit({ type: "message", payload: message });
}

async function applyTool(
  bot: Bot,
  thread: Thread,
  call: ToolCall,
  emit: (event: TurnEvent) => void,
): Promise<string> {
  const state = getWorkstation(bot.id);
  if (!state) return "No workstation";
  const dir = dataDir();

  switch (call.name) {
    case "open_app": {
      const app = str(call.arguments.app);
      if (app === "files" || app === "browser" || app === "terminal") {
        openApp(state, app);
        await saveWorkstation(state);
        emit({ type: "computer", payload: state });
        return `opened ${app}`;
      }
      return "Unknown app";
    }
    case "mouse_move": {
      moveMouse(state, num(call.arguments.x, state.cursor.x), num(call.arguments.y, state.cursor.y));
      await saveWorkstation(state);
      emit({ type: "computer", payload: state });
      return `cursor ${state.cursor.x},${state.cursor.y}`;
    }
    case "click": {
      const result = clickDesktop(state);
      await saveWorkstation(state);
      emit({ type: "computer", payload: state });
      return result;
    }
    case "type_text": {
      typeText(state, str(call.arguments.text));
      await saveWorkstation(state);
      emit({ type: "computer", payload: state });
      return "typed";
    }
    case "browse": {
      const result = await browse(state, str(call.arguments.url));
      await saveWorkstation(state);
      emit({ type: "computer", payload: state });
      return result.slice(0, 1200);
    }
    case "read_file": {
      return readHomeFile(dir, bot.id, str(call.arguments.name));
    }
    case "write_file": {
      writeHomeFile(state, dir, str(call.arguments.name), str(call.arguments.content));
      await saveWorkstation(state);
      emit({ type: "computer", payload: state });
      return `wrote ${str(call.arguments.name)}`;
    }
    case "run_shell": {
      const output = await runShell(state, str(call.arguments.command));
      await saveWorkstation(state);
      emit({ type: "computer", payload: state });
      return output.slice(0, 1500);
    }
    case "remember": {
      const text = str(call.arguments.text).slice(0, 400);
      await updateState((app) => {
        const target = app.bots.find((item) => item.id === bot.id);
        if (target) {
          target.memory.push({
            id: `mem_${crypto.randomUUID().slice(0, 6)}`,
            text,
            createdAt: new Date().toISOString(),
          });
          target.memory = target.memory.slice(-20);
        }
      });
      return "remembered";
    }
    case "request_approval": {
      const approval = await addApproval({
        threadId: thread.id,
        botId: bot.id,
        action: str(call.arguments.action) || "unknown",
        summary: str(call.arguments.summary) || "Needs approval",
        payload: call.arguments,
      });
      const message = await addMessage({
        threadId: thread.id,
        role: "approval",
        botId: bot.id,
        content: approval.summary,
        meta: { approvalId: approval.id, action: approval.action },
      });
      emit({ type: "approval", payload: { approval, message } });
      return "waiting for approval";
    }
    case "message_bot": {
      if (!thread.allowCollaboration && thread.kind !== "group" && !bot.allowCollaboration) {
        return "Collaboration is off unless the user asks.";
      }
      const target = listBots().find(
        (item) => item.name.toLowerCase() === str(call.arguments.name).toLowerCase(),
      );
      if (!target) return "No Bot with that name";
      if (target.id === bot.id) return "Cannot message yourself";
      const targetThread = thread.kind === "group" ? thread : threadForBot(target.id);
      if (!targetThread) return "No thread for that Bot";
      const handoff = await addMessage({
        threadId: targetThread.id,
        role: "handoff",
        botId: bot.id,
        content: `${bot.name} → ${target.name}: ${str(call.arguments.message)}`,
        meta: { fromBotId: bot.id, toBotId: target.id },
      });
      emit({ type: "handoff", payload: handoff });
      await addAudit({
        botId: bot.id,
        threadId: thread.id,
        kind: "handoff",
        detail: `${bot.name} messaged ${target.name}`,
      });
      return `handed off to ${target.name}`;
    }
    default:
      return `Unknown tool ${call.name}`;
  }
}

async function runRehearsal(
  bot: Bot,
  thread: Thread,
  userText: string,
  emit: (event: TurnEvent) => void,
): Promise<void> {
  const state = getWorkstation(bot.id);
  if (!state) return;
  const risky = looksLikeHardStop(userText);
  if (risky) {
    await applyTool(
      bot,
      thread,
      {
        name: "request_approval",
        arguments: {
          action: risky,
          summary: `${bot.name} wants to ${risky.replace(/_/g, " ")}: “${userText.slice(0, 140)}”`,
        },
      },
      emit,
    );
    const message = await addMessage({
      threadId: thread.id,
      role: "bot",
      botId: bot.id,
      content: `I stopped before doing that. Approve the card if you really want me to ${risky.replace(/_/g, " ")}.`,
    });
    await emitMessage(emit, message);
    return;
  }

  const shouldCollab =
    (collaborationRequested(userText) || thread.kind === "group") &&
    (thread.allowCollaboration || thread.kind === "group" || bot.allowCollaboration);
  const targets = resolveMentionedBots(userText, listBots().filter((item) => item.id !== bot.id));

  if (shouldCollab && targets.length > 0) {
    for (const target of targets.slice(0, 3)) {
      await applyTool(
        bot,
        thread,
        {
          name: "message_bot",
          arguments: {
            name: target.name,
            message: `User asked ${bot.name}: ${userText}`,
          },
        },
        emit,
      );
      await sleep(200);
    }
  }

  const wantsBrowse = /https?:\/\/\S+|browse|open .*site|look up|research|search/i.test(userText);
  const urlMatch = userText.match(/https?:\/\/\S+/);
  if (wantsBrowse) {
    openApp(state, "browser");
    moveMouse(state, 260, 110);
    await saveWorkstation(state);
    emit({ type: "computer", payload: { ...state } });
    await sleep(180);
    const url = urlMatch?.[0] || "https://example.com";
    await browse(state, url);
    await saveWorkstation(state);
    emit({ type: "computer", payload: { ...state } });
  } else if (/file|note|write|save|home directory|folder/i.test(userText)) {
    openApp(state, "files");
    const slug = userText.toLowerCase().includes("write") || userText.toLowerCase().includes("save");
    if (slug) {
      writeHomeFile(
        state,
        dataDir(),
        "draft.md",
        `# Draft\n\nRequested by user:\n\n${userText}\n`,
      );
    }
    await saveWorkstation(state);
    emit({ type: "computer", payload: { ...state } });
  } else if (/terminal|shell|run |command/i.test(userText)) {
    await runShell(state, "ls -la");
    await saveWorkstation(state);
    emit({ type: "computer", payload: { ...state } });
  }

  const caption = captionFor(bot, getWorkstation(bot.id) || state);
  const collabLine =
    shouldCollab && targets.length
      ? `I messaged ${targets.map((item) => item.name).join(", ")} as requested.`
      : thread.kind === "group"
        ? "I'm in the group and will stay in my lane unless you @ me."
        : "I kept this on my own OS — other Bots cannot see my screen unless you ask me to hand off.";

  const message = await addMessage({
    threadId: thread.id,
    role: "bot",
    botId: bot.id,
    content: [
      `${bot.name} here (${bot.title}).`,
      collabLine,
      wantsBrowse
        ? "I opened my browser and pulled the page into view. Tell me if you want a tighter brief."
        : "Give me a site, a file to write, or ask me to talk to another Bot.",
      "Rehearsal model is on. Add a provider key in Settings to use Claude, GPT, Gemini, Grok, or a local endpoint.",
    ].join(" "),
    meta: { captionPreview: caption.slice(0, 200), usedModel: "rehearsal" },
  });
  await emitMessage(emit, message);
}

export async function runTurn(input: {
  threadId: string;
  botId: string;
  userText: string;
  emit: (event: TurnEvent) => void;
}): Promise<void> {
  const thread = getThread(input.threadId);
  const bot = getBot(input.botId);
  if (!thread || !bot) {
    input.emit({ type: "error", payload: "Missing thread or Bot" });
    return;
  }

  await setBotStatus(bot.id, "working");
  try {
    if (bot.provider === "rehearsal") {
      await runRehearsal(bot, thread, input.userText, input.emit);
      return;
    }

    const workstation = getWorkstation(bot.id);
    if (!workstation) throw new Error("Missing workstation");
    const history = getState()
      .messages.filter((message) => message.threadId === thread.id)
      .slice(-16)
      .map(
        (message): ChatTurn => ({
          role: message.role === "bot" ? "assistant" : "user",
          content: `${message.role === "handoff" ? "[handoff] " : ""}${message.content}`,
        }),
      );

    const messages: ChatTurn[] = [
      { role: "system", content: systemPrompt(bot, thread, captionFor(bot, workstation)) },
      ...history,
      { role: "user", content: input.userText },
    ];

    let lastText = "";
    for (let step = 0; step < 6; step += 1) {
      const result = await completeModel({
        provider: bot.provider,
        model: bot.model,
        settings: getSettings(),
        messages,
      });
      lastText = result.text;
      if (result.toolCalls.length === 0) break;
      for (const call of result.toolCalls) {
        const computerMessage = await addMessage({
          threadId: thread.id,
          role: "computer",
          botId: bot.id,
          content: `${bot.name} used ${call.name}`,
          meta: { tool: call.name, arguments: call.arguments, usedModel: result.usedModel },
        });
        input.emit({ type: "message", payload: computerMessage });
        const toolResult = await applyTool(bot, thread, call, input.emit);
        await addAudit({
          botId: bot.id,
          threadId: thread.id,
          kind: call.name,
          detail: toolResult.slice(0, 240),
        });
        messages.push({
          role: "assistant",
          content: result.text || `call ${call.name}`,
        });
        messages.push({
          role: "tool",
          name: call.name,
          content: toolResult,
        });
      }
    }

    const message = await addMessage({
      threadId: thread.id,
      role: "bot",
      botId: bot.id,
      content: lastText.trim() || "Done.",
    });
    await emitMessage(input.emit, message);
  } catch (error) {
    const message = await addMessage({
      threadId: thread.id,
      role: "system",
      botId: bot.id,
      content: error instanceof Error ? error.message : "Turn failed",
    });
    input.emit({ type: "error", payload: message });
  } finally {
    const latest = getBot(bot.id);
    if (latest && latest.status === "working") {
      await setBotStatus(bot.id, "idle");
    }
    input.emit({ type: "done", payload: { botId: bot.id } });
  }
}

export function pickResponders(thread: Thread, userText: string): Bot[] {
  const members = thread.botIds
    .map((botId) => getBot(botId))
    .filter((bot): bot is Bot => Boolean(bot));
  if (thread.kind === "dm") return members.slice(0, 1);
  const mentioned = resolveMentionedBots(userText, members);
  if (mentioned.length > 0) return mentioned;
  return members.slice(0, 1);
}
