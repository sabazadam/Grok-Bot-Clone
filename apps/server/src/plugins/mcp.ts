/** Minimal MCP stdio client (JSON-RPC + Content-Length framing). */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Plugin } from "@grokbot/shared";

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class McpClient {
  private proc: ChildProcessWithoutNullStreams;
  private buf = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(plugin: Plugin) {
    if (!plugin.command) throw new Error("MCP plugin is missing a command");
    this.proc = spawn(plugin.command, plugin.args ?? [], {
      env: { ...process.env, ...plugin.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (chunk: Buffer) => this.onData(chunk));
    this.proc.stderr.on("data", () => undefined);
    this.proc.on("exit", () => {
      for (const p of this.pending.values()) p.reject(new Error("MCP server exited"));
      this.pending.clear();
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "grokbot", version: "0.1.0" },
    });
    this.notify("notifications/initialized", {});
  }

  async listTools(): Promise<{ name: string; description?: string }[]> {
    const result = (await this.request("tools/list", {})) as { tools?: { name: string; description?: string }[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", { name, arguments: args })) as {
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    const text = (result.content ?? []).map((c) => c.text ?? "").filter(Boolean).join("\n");
    if (result.isError) throw new Error(text || "MCP tool error");
    return text || "(empty)";
  }

  close(): void {
    try {
      this.proc.kill();
    } catch {
      /* ignore */
    }
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP timeout: ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private write(msg: unknown): void {
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buf.subarray(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(match[1]);
      const start = headerEnd + 4;
      if (this.buf.length < start + len) return;
      const json = this.buf.subarray(start, start + len).toString("utf8");
      this.buf = this.buf.subarray(start + len);
      try {
        const msg = JSON.parse(json) as { id?: number; result?: unknown; error?: { message?: string } };
        if (typeof msg.id === "number") {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p?.reject(new Error(msg.error.message || "MCP error"));
          else p?.resolve(msg.result);
        }
      } catch {
        /* ignore malformed frames */
      }
    }
  }
}

const pool = new Map<string, McpClient>();

export async function mcpFor(plugin: Plugin): Promise<McpClient> {
  const existing = pool.get(plugin.id);
  if (existing) return existing;
  const client = new McpClient(plugin);
  await client.initialize();
  pool.set(plugin.id, client);
  return client;
}

export function closeMcp(pluginId: string): void {
  pool.get(pluginId)?.close();
  pool.delete(pluginId);
}
