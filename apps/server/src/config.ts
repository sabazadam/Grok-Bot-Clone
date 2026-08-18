import "dotenv/config";
import path from "node:path";
import fs from "node:fs";

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  port: Number(env("PORT", "8484")),
  host: env("HOST", "127.0.0.1"),
  dataDir: path.resolve(process.cwd(), env("DATA_DIR", "./data")),

  anthropicApiKey: env("ANTHROPIC_API_KEY", ""),
  openaiApiKey: env("OPENAI_API_KEY", ""),
  googleApiKey: env("GOOGLE_API_KEY", ""),
  xaiApiKey: env("XAI_API_KEY", ""),
  xaiBaseUrl: env("XAI_BASE_URL", "https://api.x.ai/v1"),

  maxRunningComputers: Number(env("MAX_RUNNING_COMPUTERS", "4")),
  computerIdleStopMinutes: Number(env("COMPUTER_IDLE_STOP_MINUTES", "30")),
  computerResolution: env("COMPUTER_RESOLUTION", "1280x800"),
  computerMemory: env("COMPUTER_MEMORY", "2g"),
  dockerSocket: env("DOCKER_SOCKET", "/var/run/docker.sock"),

  /** Stealth browsing defaults (used by agents with stealthBrowsing on). */
  browserUserAgent: env(
    "BROWSER_USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ),
  browserTimezone: env("BROWSER_TIMEZONE", "America/New_York"),
  browserLocale: env("BROWSER_LOCALE", "en-US"),

  /** Max computer-use loop steps per task */
  maxTaskSteps: Number(env("MAX_TASK_STEPS", "60")),
  /** Max agent-to-agent turns triggered by one user message (loop prevention) */
  maxAgentTurns: Number(env("MAX_AGENT_TURNS", "8")),

  agentDesktopImage: env("AGENT_DESKTOP_IMAGE", "grokbot/agent-desktop:latest"),
};

export function ensureDataDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "screenshots"), { recursive: true });
}
