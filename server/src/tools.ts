import { execCommand, performAction, takeScreenshot } from './computers.js';
import type { ToolDef, Part, ToolCall } from './providers/types.js';
import type { Activity, AgentRow } from './types.js';

export const SCREEN = { width: 1280, height: 800 };

export function buildToolDefs(): ToolDef[] {
  return [
    {
      name: 'computer',
      description:
        `Use your computer's screen, mouse, and keyboard. The screen is ${SCREEN.width}x${SCREEN.height} pixels; ` +
        `(0,0) is the top-left corner. After every action you receive a fresh screenshot. ` +
        `Actions: "screenshot" (just look), "click"/"double_click"/"right_click"/"middle_click" {x,y}, ` +
        `"move" {x,y}, "drag" {x1,y1,x2,y2}, "scroll" {direction:"up|down|left|right", amount, x?, y?}, ` +
        `"type" {text} (types into the focused element — click it first), ` +
        `"key" {keys} (space-separated X11 key names/combos, e.g. "Return", "ctrl+l", "alt+Tab"), ` +
        `"wait" {seconds} (let the UI settle, max 15), ` +
        `"launch" {command} (start a GUI app detached, e.g. "browser https://example.com" or "xterm").`,
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'screenshot', 'click', 'double_click', 'right_click', 'middle_click',
              'move', 'drag', 'scroll', 'type', 'key', 'wait', 'launch',
            ],
          },
          x: { type: 'integer' }, y: { type: 'integer' },
          x1: { type: 'integer' }, y1: { type: 'integer' },
          x2: { type: 'integer' }, y2: { type: 'integer' },
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
          amount: { type: 'integer' },
          text: { type: 'string' },
          keys: { type: 'string' },
          seconds: { type: 'number' },
          command: { type: 'string' },
        },
        required: ['action'],
      },
    },
    {
      name: 'terminal',
      description:
        'Run a shell command on your own computer (bash, non-root user "agent"). Returns stdout/stderr/exit code. ' +
        'Use for file work, scripts, curl, installs into your home dir, etc. Working dir is ~. ' +
        'Keep durable files in ~/workspace. For GUI apps use computer.launch instead.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          timeout: { type: 'number', description: 'seconds, default 60, max 600' },
        },
        required: ['command'],
      },
    },
    {
      name: 'message_agent',
      description:
        'Send an asynchronous message to another agent on the team (they have their own separate computer). ' +
        'They will wake up, handle it, and may reply to you later. Use when work should be handed off or ' +
        'when a teammate owns that area. Address them by name.',
      inputSchema: {
        type: 'object',
        properties: {
          agent_name: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['agent_name', 'message'],
      },
    },
    {
      name: 'ask_user',
      description:
        'Pause and ask your human a question or request approval. Use before irreversible or external actions ' +
        '(sending, publishing, purchasing, deleting) and whenever credentials are needed — never ask for ' +
        'passwords in chat; ask the user to take over your screen instead. Ends your turn.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
      },
    },
    {
      name: 'remember',
      description:
        'Save a short durable note to your memory (preferences, facts, how-tos). It will be shown to you in ' +
        'future conversations. Keep notes short and factual.',
      inputSchema: {
        type: 'object',
        properties: { note: { type: 'string' } },
        required: ['note'],
      },
    },
  ];
}

export interface ToolContext {
  agent: AgentRow;
  /** Deliver a message to another agent; returns an error string or null on success. */
  sendPeerMessage(targetName: string, message: string): string | null;
  /** Append a note to this agent's memory. */
  remember(note: string): void;
}

export interface ToolOutcome {
  resultParts: Part[];
  activity: Activity;
  isError?: boolean;
}

const MUTATING_ACTIONS = new Set([
  'click', 'double_click', 'right_click', 'middle_click',
  'move', 'drag', 'scroll', 'type', 'key', 'wait', 'launch',
]);

function summarizeComputerAction(input: Record<string, unknown>): string {
  const a = String(input.action);
  switch (a) {
    case 'screenshot': return 'took a screenshot';
    case 'click': return `clicked at (${input.x}, ${input.y})`;
    case 'double_click': return `double-clicked at (${input.x}, ${input.y})`;
    case 'right_click': return `right-clicked at (${input.x}, ${input.y})`;
    case 'middle_click': return `middle-clicked at (${input.x}, ${input.y})`;
    case 'move': return `moved mouse to (${input.x}, ${input.y})`;
    case 'drag': return `dragged (${input.x1}, ${input.y1}) → (${input.x2}, ${input.y2})`;
    case 'scroll': return `scrolled ${input.direction ?? 'down'} ×${input.amount ?? 3}`;
    case 'type': return `typed "${String(input.text ?? '').slice(0, 80)}"`;
    case 'key': return `pressed ${input.keys}`;
    case 'wait': return `waited ${input.seconds ?? 1}s`;
    case 'launch': return `launched: ${String(input.command ?? '').slice(0, 80)}`;
    default: return a;
  }
}

async function screenshotPart(agent: AgentRow): Promise<Part> {
  const png = await takeScreenshot(agent);
  return { type: 'image', base64: png.toString('base64') };
}

export async function executeTool(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  const { agent } = ctx;
  const input = call.input ?? {};

  try {
    switch (call.name) {
      case 'computer': {
        const action = String(input.action ?? '');
        const summary = summarizeComputerAction(input);
        if (action === 'screenshot') {
          return {
            resultParts: [await screenshotPart(agent)],
            activity: { kind: 'screenshot', summary },
          };
        }
        if (!MUTATING_ACTIONS.has(action)) {
          throw new Error(`unknown computer action "${action}"`);
        }
        await performAction(agent, { type: action, ...input });
        // Give the UI a moment to settle, then show the model what happened.
        await new Promise((r) => setTimeout(r, action === 'launch' ? 1500 : 400));
        return {
          resultParts: [
            { type: 'text', text: `done: ${summary}` },
            await screenshotPart(agent),
          ],
          activity: { kind: action as Activity['kind'], summary },
        };
      }

      case 'terminal': {
        const command = String(input.command ?? '');
        const timeout = Math.min(Number(input.timeout ?? 60) || 60, 600);
        const result = await execCommand(agent, command, timeout);
        const output = [
          result.error ? `error: ${result.error}` : `exit code: ${result.exit_code}`,
          result.stdout ? `stdout:\n${result.stdout}` : '',
          result.stderr ? `stderr:\n${result.stderr}` : '',
        ].filter(Boolean).join('\n');
        return {
          resultParts: [{ type: 'text', text: output || 'exit code: 0' }],
          activity: {
            kind: 'exec',
            summary: `$ ${command.slice(0, 100)}`,
            detail: output.slice(0, 2000),
          },
          isError: result.ok === false || (result.exit_code ?? 0) !== 0,
        };
      }

      case 'message_agent': {
        const targetName = String(input.agent_name ?? '');
        const message = String(input.message ?? '');
        const error = ctx.sendPeerMessage(targetName, message);
        if (error) {
          return {
            resultParts: [{ type: 'text', text: error }],
            activity: { kind: 'thought', summary: `failed to message ${targetName}: ${error}` },
            isError: true,
          };
        }
        return {
          resultParts: [{
            type: 'text',
            text: `Message delivered to ${targetName}. They will process it asynchronously and may reply later; you can finish your turn.`,
          }],
          activity: { kind: 'thought', summary: `messaged ${targetName}`, detail: message.slice(0, 2000) },
        };
      }

      case 'remember': {
        const note = String(input.note ?? '').trim();
        if (note) ctx.remember(note);
        return {
          resultParts: [{ type: 'text', text: 'noted.' }],
          activity: { kind: 'remember', summary: `remembered: ${note.slice(0, 100)}` },
        };
      }

      default:
        return {
          resultParts: [{ type: 'text', text: `unknown tool: ${call.name}` }],
          activity: { kind: 'thought', summary: `called unknown tool ${call.name}` },
          isError: true,
        };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      resultParts: [{ type: 'text', text: `tool error: ${message}` }],
      activity: { kind: 'thought', summary: `error: ${message.slice(0, 120)}` },
      isError: true,
    };
  }
}
