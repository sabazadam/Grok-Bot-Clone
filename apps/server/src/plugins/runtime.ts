import type { Plugin } from "@grokbot/shared";
import * as store from "../store.js";
import { closeMcp, mcpFor } from "./mcp.js";

export async function pluginCatalog(signal?: AbortSignal): Promise<string> {
  const plugins = store.listPlugins().filter((p) => p.enabled);
  if (plugins.length === 0) return "";
  const lines: string[] = ["## Plugins / connectors", "You can call configured plugins with call_plugin."];
  for (const p of plugins) {
    if (signal?.aborted) break;
    if (p.kind === "webhook") {
      lines.push(`- ${p.name} (webhook id=${p.id}) — POST JSON {tool, arguments} to the configured URL`);
      continue;
    }
    try {
      const client = await mcpFor(p);
      const tools = await client.listTools();
      const listed = tools.map((t) => `${t.name}${t.description ? `: ${t.description}` : ""}`).join("; ");
      lines.push(`- ${p.name} (mcp id=${p.id}) tools: ${listed || "(none listed)"}`);
    } catch (err) {
      lines.push(`- ${p.name} (mcp id=${p.id}) — currently unreachable: ${(err as Error).message}`);
    }
  }
  return lines.join("\n");
}

export async function callPlugin(pluginId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
  const plugin = store.getPlugin(pluginId) ?? store.listPlugins().find((p) => p.name.toLowerCase() === pluginId.toLowerCase());
  if (!plugin) throw new Error(`no plugin "${pluginId}"`);
  if (!plugin.enabled) throw new Error(`plugin "${plugin.name}" is disabled`);
  if (plugin.kind === "webhook") {
    if (!plugin.url) throw new Error(`webhook plugin "${plugin.name}" has no URL`);
    const res = await fetch(plugin.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool: toolName, arguments: args, plugin: plugin.name }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}: ${text.slice(0, 500)}`);
    return text.slice(0, 8000) || "ok";
  }
  const client = await mcpFor(plugin);
  return client.callTool(toolName, args);
}

export function forgetPlugin(pluginId: string): void {
  closeMcp(pluginId);
}

export function enabledPlugins(): Plugin[] {
  return store.listPlugins().filter((p) => p.enabled);
}
