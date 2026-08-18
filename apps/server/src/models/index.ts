import type { Agent } from "@grokbot/shared";
import { parseResolution } from "@grokbot/shared";
import { config } from "../config.js";
import type { AdapterInit, ModelAdapter } from "./types.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAIAdapter } from "./openai.js";
import { GeminiAdapter } from "./gemini.js";
import { GenericAdapter } from "./generic.js";
import { MockAdapter } from "./mock.js";

export * from "./types.js";

export function createAdapter(agent: Agent, systemPrompt: string, fetchFn?: typeof fetch): ModelAdapter {
  const init: AdapterInit = {
    model: agent.model,
    systemPrompt,
    resolution: parseResolution(config.computerResolution),
    apiKey: "",
    collaborationEnabled: agent.collaborationEnabled,
    fetchFn,
  };

  // deterministic scripted model for keyless development/testing
  if (agent.model === "mock-scripted") {
    return new MockAdapter(init);
  }

  switch (agent.provider) {
    case "anthropic":
      if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is not set — add it to .env and restart.");
      return new AnthropicAdapter({ ...init, apiKey: config.anthropicApiKey });
    case "openai":
      if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is not set — add it to .env and restart.");
      return new OpenAIAdapter({ ...init, apiKey: config.openaiApiKey });
    case "google":
      if (!config.googleApiKey) throw new Error("GOOGLE_API_KEY is not set — add it to .env and restart.");
      return new GeminiAdapter({ ...init, apiKey: config.googleApiKey });
    case "generic":
      if (!config.xaiApiKey) throw new Error("XAI_API_KEY is not set — add it to .env and restart.");
      return new GenericAdapter({ ...init, apiKey: config.xaiApiKey, baseUrl: config.xaiBaseUrl });
    default:
      throw new Error(`unknown provider ${agent.provider}`);
  }
}
