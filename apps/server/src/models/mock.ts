/**
 * Mock adapter — deterministic scripted "model" for developing and testing the
 * full pipeline WITHOUT any API key. Enabled by setting an agent's model to
 * "mock-scripted". It understands a handful of prompt directives:
 *
 *   open the browser to <url>
 *   run: <shell command>
 *   type into a terminal: <text>
 *   save file <path> containing: <text>
 *   ask approval to <something>
 *   tell @<AgentName>: <text>
 *   say: <text>
 *   save skill <Name>: <instructions>
 *   create agent <Name> as <Role>: <instructions>
 *   schedule every <N> min: <prompt>
 *   remember: <text>
 *
 * Anything else results in: screenshot → short final reply.
 */
import type { AdapterInit, AgentDecision, ModelAdapter, ToolOutcome } from "./types.js";
import type { ToolInvocation } from "./types.js";

export class MockAdapter implements ModelAdapter {
  private queue: ToolInvocation[] = [];
  private counter = 0;
  private notes: string[] = [];
  private approvalRejected = false;
  private fromTeammate = false;
  private hadDirectives = false;

  constructor(private init: AdapterInit) {}

  private id(): string {
    return `mock_${++this.counter}`;
  }

  private plan(prompt: string): void {
    // Only parse directives from the NEW message, not the transcript context
    // (the runner prefixes prompts with "Recent conversation:" + "New message from …:").
    const marker = prompt.lastIndexOf("New message from");
    let effective = prompt;
    if (marker >= 0) {
      const nl = prompt.indexOf("\n", marker);
      if (nl >= 0) effective = prompt.slice(nl + 1);
    }
    const lines = effective.split(/\n|(?<=\.)\s+/);
    for (const raw of lines) {
      // strip leading @mentions ("@Milo run: ..." → "run: ...")
      const line = raw.trim().replace(/^(@\S+[,:]?\s+)+/, "");
      let m: RegExpMatchArray | null;
      if ((m = line.match(/tell @(\S+):\s*(.+)$/i))) {
        this.queue.push({ id: this.id(), tool: "send_message_to_agent", toAgentName: m[1]!, text: m[2]! });
      } else if ((m = line.match(/^say:\s*(.+)$/i))) {
        this.queue.push({ id: this.id(), tool: "send_message", text: m[1]! });
      } else if ((m = line.match(/^save skill ([^:]+):\s*(.+)$/i))) {
        this.queue.push({
          id: this.id(),
          tool: "save_skill",
          name: m[1]!.trim(),
          description: "",
          instructions: m[2]!,
        });
      } else if ((m = line.match(/^create agent (\S+) as ([^:]+):\s*(.+)$/i))) {
        this.queue.push({
          id: this.id(),
          tool: "create_agent",
          name: m[1]!,
          roleTitle: m[2]!.trim(),
          instructions: m[3]!,
        });
      } else if ((m = line.match(/^schedule (.+):\s*(.+)$/i))) {
        this.queue.push({
          id: this.id(),
          tool: "create_routine",
          name: "Scheduled",
          prompt: m[2]!,
          schedule: m[1]!,
        });
      } else if ((m = line.match(/open the browser to (\S+)/i))) {
        this.queue.push({
          id: this.id(),
          tool: "bash",
          command: `DISPLAY=:0 nohup /usr/local/bin/browser '${m[1]!.replace(/'/g, "")}' >/dev/null 2>&1 & sleep 5; echo opened`,
        });
        this.queue.push({ id: this.id(), tool: "computer", action: { type: "screenshot" } });
      } else if ((m = line.match(/^run:\s*(.+)$/i))) {
        this.queue.push({ id: this.id(), tool: "bash", command: m[1]! });
      } else if ((m = line.match(/type into a terminal:\s*(.+)$/i))) {
        this.queue.push({
          id: this.id(),
          tool: "bash",
          command: "DISPLAY=:0 nohup xterm >/dev/null 2>&1 & sleep 2; DISPLAY=:0 xdotool search --sync --class xterm windowactivate; echo ready",
        });
        this.queue.push({ id: this.id(), tool: "computer", action: { type: "type", text: m[1]! + "\n" } });
        this.queue.push({ id: this.id(), tool: "computer", action: { type: "screenshot" } });
      } else if ((m = line.match(/save file (\S+) containing:\s*(.+)$/i))) {
        this.queue.push({ id: this.id(), tool: "bash", command: `mkdir -p "$(dirname '${m[1]}')" && printf '%s\\n' '${m[2]!.replace(/'/g, "'\\''")}' > '${m[1]}' && cat '${m[1]}'` });
      } else if ((m = line.match(/ask approval to (.+)$/i))) {
        this.queue.push({ id: this.id(), tool: "request_approval", description: m[1]!, reason: "The task asked me to get your sign-off first." });
      } else if ((m = line.match(/^remember:\s*(.+)$/i))) {
        this.queue.push({ id: this.id(), tool: "update_memory", memoryKind: "fact", content: m[1]! });
      }
    }
    this.fromTeammate = /New message from your teammate/.test(prompt);
    this.hadDirectives = this.queue.length > 0;
    if (this.queue.length === 0 && !this.fromTeammate) {
      this.queue.push({ id: this.id(), tool: "computer", action: { type: "screenshot" } });
    }
  }

  async start(taskPrompt: string, _screenshotB64: string): Promise<AgentDecision> {
    this.plan(taskPrompt);
    return this.step();
  }

  async next(outcomes: ToolOutcome[]): Promise<AgentDecision> {
    for (const o of outcomes) {
      if (o.tool === "request_approval" && /rejected/i.test(o.output)) {
        this.approvalRejected = true;
        this.queue = [];
      }
      if (o.output && o.tool === "bash") this.notes.push(o.output.trim().slice(0, 200));
    }
    return this.step();
  }

  private step(): AgentDecision {
    const inv = this.queue.shift();
    if (!inv) {
      if (this.approvalRejected) {
        return { kind: "final", text: "Understood — I stopped there and won't proceed without your approval." };
      }
      // teammate messages that needed no action end the thread with the ACK convention
      if (this.fromTeammate && !this.hadDirectives) {
        return { kind: "final", text: "ACK" };
      }
      const summary = this.notes.length > 0 ? `Done. Output:\n${this.notes.join("\n")}` : "Done (mock run complete).";
      return { kind: "final", text: summary };
    }
    return { kind: "act", invocations: [inv] };
  }
}
