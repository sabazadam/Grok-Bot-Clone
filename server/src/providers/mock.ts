import type { ChatRequest, ChatResponse, Provider } from './types.js';

/**
 * Offline scripted provider. Runs a fixed computer-use demo so the whole
 * pipeline (container, actions, screenshots, activities, UI streaming) can be
 * exercised without any API key.
 */

const SCRIPT: { name: string; input: Record<string, unknown> }[][] = [
  [{ name: 'terminal', input: { command: 'echo "Botbox mock agent online: $(hostname)" | tee ~/workspace/hello.txt' } }],
  [{ name: 'computer', input: { action: 'launch', command: 'xterm -geometry 120x30+40+40 -fa DejaVu -fs 11' } }],
  [{ name: 'computer', input: { action: 'wait', seconds: 2 } }],
  [{ name: 'computer', input: { action: 'click', x: 500, y: 250 } }],
  [{ name: 'computer', input: { action: 'type', text: 'echo typed-by-mock-agent' } }],
  [{ name: 'computer', input: { action: 'key', keys: 'Return' } }],
  [{ name: 'computer', input: { action: 'screenshot' } }],
  [{ name: 'remember', input: { note: 'Completed the scripted mock demo once.' } }],
];

export const mockProvider: Provider = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    await new Promise((r) => setTimeout(r, 400));
    const assistantTurns = req.turns.filter((t) => t.role === 'assistant').length;
    // Figure out which step of the current run we're on: count assistant turns
    // since the last plain user text turn (a new run replays history).
    let step = 0;
    for (let i = req.turns.length - 1; i >= 0; i--) {
      const turn = req.turns[i];
      if (turn.role === 'assistant') step++;
      if (turn.role === 'user' && turn.content.some((p) => p.type === 'text')) break;
    }

    if (step < SCRIPT.length) {
      const calls = SCRIPT[step];
      return {
        text: step === 0 ? 'Starting the scripted demo on my computer.' : '',
        toolCalls: calls.map((c, i) => ({
          id: `mock_${assistantTurns}_${i}`,
          name: c.name,
          input: c.input,
        })),
      };
    }
    return {
      text:
        'Mock demo complete. I wrote ~/workspace/hello.txt, opened a terminal on my desktop, ' +
        'typed a command into it, and took a screenshot — watch it on my computer view. ' +
        'Create an agent with a real provider to give me actual work.',
      toolCalls: [],
    };
  },
};
