import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useTestDb } from "../db.js";
import * as store from "../store.js";
import { callPlugin, pluginCatalog } from "./runtime.js";

beforeEach(() => {
  useTestDb();
});

describe("callPlugin", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs JSON to a webhook plugin", async () => {
    const plugin = store.createPlugin({
      name: "Status hook",
      kind: "webhook",
      url: "https://example.test/hook",
    });
    const fetchMock = vi.fn(async () => new Response("pong", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(callPlugin(plugin.id, "ping", { q: "ok" })).resolves.toBe("pong");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0]?.[0]).toBe("https://example.test/hook");
    expect(JSON.parse(String(calls[0]?.[1].body))).toEqual({
      tool: "ping",
      arguments: { q: "ok" },
      plugin: "Status hook",
    });
  });

  it("refuses non-http webhook URLs", async () => {
    const plugin = store.createPlugin({
      name: "Local file",
      kind: "webhook",
      url: "file:///etc/passwd",
    });
    await expect(callPlugin(plugin.id, "read", {})).rejects.toThrow(/http/);
  });

  it("looks up plugins by name and refuses disabled ones", async () => {
    const plugin = store.createPlugin({
      name: "CRM",
      kind: "webhook",
      url: "https://example.test/crm",
    });
    store.updatePlugin(plugin.id, { enabled: false });
    await expect(callPlugin("CRM", "search", {})).rejects.toThrow(/disabled/);
  });
});

describe("pluginCatalog", () => {
  it("lists enabled webhook plugins for the system prompt", async () => {
    store.createPlugin({ name: "Status hook", kind: "webhook", url: "https://example.test/hook" });
    const catalog = await pluginCatalog();
    expect(catalog).toMatch(/call_plugin/);
    expect(catalog).toMatch(/Status hook/);
  });
});
