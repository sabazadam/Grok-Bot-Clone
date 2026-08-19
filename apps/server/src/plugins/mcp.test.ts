import { describe, it, expect } from "vitest";
import { mcpProcessEnv } from "./mcp.js";

describe("mcpProcessEnv", () => {
  it("does not inherit host API keys", () => {
    const prev = process.env.XAI_API_KEY;
    process.env.XAI_API_KEY = "secret-should-not-leak";
    try {
      const env = mcpProcessEnv({ SLACK_BOT_TOKEN: "plugin-own-secret" });
      expect(env.XAI_API_KEY).toBeUndefined();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.SLACK_BOT_TOKEN).toBe("plugin-own-secret");
      expect(env.PATH).toBe(process.env.PATH);
    } finally {
      if (prev === undefined) delete process.env.XAI_API_KEY;
      else process.env.XAI_API_KEY = prev;
    }
  });
});
