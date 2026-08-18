import {
  getAgent, findAgentByName, insertMessage, listAgents, listMessages, updateAgent,
} from './db.js';
import { startComputer } from './computers.js';
import { broadcastAgent, broadcastMessage } from './events.js';
import { getProvider, resolveConfig } from './providers/index.js';
import type { Part, Turn } from './providers/types.js';
import { SCREEN, buildToolDefs, executeTool, type ToolContext } from './tools.js';
import type { Activity, AgentRow, Message } from './types.js';

const MAX_STEPS = 40;
const MAX_IMAGES_IN_CONTEXT = 3;
const MAX_PEER_HOPS = 6;
const MEMORY_LIMIT = 4000;

const running = new Set<string>();
const rerunRequested = new Set<string>();
const stopRequested = new Set<string>();

export function triggerRun(agentId: string): void {
  if (running.has(agentId)) {
    rerunRequested.add(agentId);
    return;
  }
  running.add(agentId);
  void runAgent(agentId)
    .catch((err) => console.error(`[loop] run for ${agentId} crashed:`, err))
    .finally(() => {
      running.delete(agentId);
      if (rerunRequested.delete(agentId)) triggerRun(agentId);
    });
}

export function stopRun(agentId: string): void {
  if (running.has(agentId)) stopRequested.add(agentId);
}

export function isRunning(agentId: string): boolean {
  return running.has(agentId);
}

function setStatus(agentId: string, status: AgentRow['status']): void {
  const row = updateAgent(agentId, { status });
  if (row) broadcastAgent(row);
}

function postMessage(m: Parameters<typeof insertMessage>[0]): Message {
  const message = insertMessage(m);
  broadcastMessage(message);
  return message;
}

function postActivity(agentId: string, activity: Activity): void {
  postMessage({ agentId, role: 'activity', content: JSON.stringify(activity) });
}

function buildSystemPrompt(agent: AgentRow): string {
  const teammates = listAgents()
    .filter((a) => a.id !== agent.id)
    .map((a) => `- ${a.name}${a.title ? ` (${a.title})` : ''}`)
    .join('\n');

  return [
    `You are ${agent.name}, an autonomous AI teammate.`,
    agent.title ? `Your role: ${agent.title}.` : '',
    agent.description ? `How you should work (standing instructions from your human):\n${agent.description}` : '',
    '',
    `You have your OWN dedicated Linux computer (nobody else uses it): a ${SCREEN.width}x${SCREEN.height} desktop with a browser ` +
      '(launch with computer.launch "browser <url>"), a terminal (the `terminal` tool), and a persistent home directory. ' +
      'Keep durable files in ~/workspace. Your computer persists between conversations.',
    '',
    'Operating guidelines:',
    '- Prefer the terminal for file and data work; use the GUI (mouse/keyboard) for websites and visual apps.',
    '- After GUI actions you get a screenshot: LOOK at it and verify the action worked before continuing.',
    '- Click on input fields before typing. Use precise coordinates from the latest screenshot.',
    '- Never ask for or type passwords/2FA codes yourself: use ask_user so the human can take over your screen.',
    '- Before irreversible or externally visible actions (sending, publishing, purchasing, deleting), use ask_user.',
    '- Finish jobs end to end. When done, reply with a concise summary of what you did and where the results are.',
    teammates
      ? `\nYour teammates (each has their own separate computer). Hand work off with message_agent:\n${teammates}`
      : '',
    agent.memory ? `\nYour memory (notes you saved earlier):\n${agent.memory}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Convert persisted thread history into provider turns (text only across runs). */
function historyToTurns(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  const push = (role: Turn['role'], text: string) => {
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content.push({ type: 'text', text });
    } else {
      turns.push({ role, content: [{ type: 'text', text }] });
    }
  };

  for (const m of messages) {
    switch (m.role) {
      case 'user':
        push('user', m.content);
        break;
      case 'peer_in':
        push('user', `[Message from your teammate ${m.senderName ?? 'unknown'}]\n${m.content}`);
        break;
      case 'assistant':
        push('assistant', m.content);
        break;
      case 'peer_out':
        push('assistant', `[I sent a message to ${String(m.meta?.toName ?? 'a teammate')}]\n${m.content}`);
        break;
      default:
        break; // activity + system messages are UI-only
    }
  }
  // Providers require the conversation to start with a user turn.
  while (turns.length && turns[0].role !== 'user') turns.shift();
  return turns;
}

/** Keep only the most recent N screenshots in context to bound token usage. */
function pruneImages(turns: Turn[]): void {
  let seen = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    for (let j = turns[i].content.length - 1; j >= 0; j--) {
      const part = turns[i].content[j];
      if (part.type === 'image') {
        seen++;
        if (seen > MAX_IMAGES_IN_CONTEXT) {
          turns[i].content[j] = { type: 'text', text: '[older screenshot omitted]' };
        }
      } else if (part.type === 'tool_result') {
        for (let k = part.content.length - 1; k >= 0; k--) {
          const inner = part.content[k];
          if (inner.type === 'image') {
            seen++;
            if (seen > MAX_IMAGES_IN_CONTEXT) {
              part.content[k] = { type: 'text', text: '[older screenshot omitted]' };
            }
          }
        }
      }
    }
  }
}

function currentPeerHops(messages: Message[]): number {
  let hops = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant') break;
    if (m.role === 'peer_in') {
      hops = Math.max(hops, Number(m.meta?.hops ?? 1));
    }
    if (m.role === 'user') break; // direct human involvement resets the chain
  }
  return hops;
}

async function runAgent(agentId: string): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent) return;
  stopRequested.delete(agentId);
  setStatus(agentId, 'working');

  try {
    // Make sure the computer is up (boots it on first message).
    let live = getAgent(agentId)!;
    if (live.computerState !== 'running') {
      try {
        live = await startComputer(agentId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        postMessage({ agentId, role: 'system', content: `Computer failed to start: ${msg}` });
        setStatus(agentId, 'idle');
        return;
      }
    }

    const history = listMessages(agentId, 400);
    const hops = currentPeerHops(history);
    const turns = historyToTurns(history);
    if (turns.length === 0) {
      setStatus(agentId, 'idle');
      return;
    }

    const provider = getProvider(live.provider);
    const config = resolveConfig(live.provider);
    const tools = buildToolDefs();

    const toolContext: ToolContext = {
      agent: live,
      sendPeerMessage: (targetName, message) => {
        if (hops >= MAX_PEER_HOPS) {
          return 'agent-to-agent hop limit reached for this task; report back to the user instead';
        }
        const target = findAgentByName(targetName);
        if (!target) return `no agent named "${targetName}" exists`;
        if (target.id === agentId) return 'you cannot message yourself';
        postMessage({
          agentId,
          role: 'peer_out',
          content: message,
          meta: { toName: target.name, toAgentId: target.id },
        });
        postMessage({
          agentId: target.id,
          role: 'peer_in',
          content: message,
          senderAgentId: agentId,
          senderName: live.name,
          meta: { hops: hops + 1 },
        });
        triggerRun(target.id);
        return null;
      },
      remember: (note) => {
        const current = getAgent(agentId)?.memory ?? '';
        const next = `${current}\n- ${note}`.trim().slice(-MEMORY_LIMIT);
        const row = updateAgent(agentId, { memory: next });
        if (row) broadcastAgent(row);
      },
    };

    let askedUser = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      if (stopRequested.has(agentId)) {
        postMessage({ agentId, role: 'system', content: 'Stopped by user.' });
        break;
      }

      pruneImages(turns);
      let response;
      try {
        response = await provider.chat(
          { model: live.model, system: buildSystemPrompt(live), turns, tools },
          config,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        postMessage({ agentId, role: 'system', content: `Model call failed: ${msg}` });
        break;
      }

      if (response.toolCalls.length === 0) {
        if (response.text) {
          postMessage({ agentId, role: 'assistant', content: response.text });
        }
        break;
      }

      // Record the assistant turn (thought text + tool calls).
      const assistantParts: Part[] = [];
      if (response.text) {
        assistantParts.push({ type: 'text', text: response.text });
        postActivity(agentId, { kind: 'thought', summary: response.text.slice(0, 300) });
      }
      for (const call of response.toolCalls) {
        assistantParts.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      turns.push({ role: 'assistant', content: assistantParts });

      // Execute tool calls and build the tool-result turn.
      const resultParts: Part[] = [];
      for (const call of response.toolCalls) {
        if (call.name === 'ask_user') {
          const question = String(call.input.question ?? 'I need your input to continue.');
          postMessage({ agentId, role: 'assistant', content: question });
          askedUser = true;
          resultParts.push({
            type: 'tool_result',
            toolUseId: call.id,
            content: [{ type: 'text', text: 'question delivered; waiting for the user' }],
          });
          continue;
        }
        const outcome = await executeTool(toolContext, call);
        postActivity(agentId, outcome.activity);
        resultParts.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: outcome.resultParts,
          ...(outcome.isError ? { isError: true } : {}),
        });
      }
      turns.push({ role: 'user', content: resultParts });

      if (askedUser) break;

      if (step === MAX_STEPS - 1) {
        postMessage({
          agentId,
          role: 'system',
          content: `Reached the ${MAX_STEPS}-step limit for a single run. Message the agent to continue.`,
        });
      }
    }

    setStatus(agentId, askedUser ? 'needs_attention' : 'idle');
  } catch (err) {
    console.error(`[loop] unexpected error for ${agentId}:`, err);
    postMessage({
      agentId,
      role: 'system',
      content: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    });
    setStatus(agentId, 'idle');
  } finally {
    stopRequested.delete(agentId);
  }
}
