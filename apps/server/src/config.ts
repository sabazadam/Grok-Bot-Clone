import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PROVIDER_DEFAULT_MODELS, type Provider } from "@grokbot/shared";

// Load .env robustly regardless of cwd: repo root (setup.sh writes it there) first,
// then the current working directory. Works for `npm run dev`, and when the desktop
// app spawns the server from a different directory.
const here = path.dirname(fileURLToPath(import.meta.url));
for (const p of [
  process.env.GROKBOT_ENV,
  path.resolve(here, "../../../.env"),
  path.resolve(process.cwd(), ".env"),
]) {
  if (p && fs.existsSync(p)) dotenv.config({ path: p });
}

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

  /**
   * Host interface the per-agent noVNC (live desktop) ports bind to.
   *  - "127.0.0.1" (default): single-device use — only reachable on this machine.
   *  - a Tailscale IP / "0.0.0.0": server/commander use — the desktop view is reachable
   *    from another device (e.g. your MacBook over Tailscale).
   * The API and the in-container actuator always stay on loopback; the web UI reaches
   * them via the Vite proxy, so only these noVNC ports are ever exposed.
   */
  computerBindHost: env("COMPUTER_BIND_HOST", "127.0.0.1"),
  /** Human-readable access mode, recorded by setup for diagnostics. */
  accessMode: env("ACCESS_MODE", "local"),

  /** Stealth browsing defaults (used by agents with stealthBrowsing on). */
  browserUserAgent: env(
    "BROWSER_USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  ),
  browserTimezone: env("BROWSER_TIMEZONE", "America/New_York"),
  browserLocale: env("BROWSER_LOCALE", "en-US"),
  /** Default browser engine for new agents: "chromium" (default) or "camoufox" (hard sites). */
  browserEngineDefault: env("BROWSER_ENGINE", "chromium"),

  /** Max computer-use loop steps per task */
  maxTaskSteps: Number(env("MAX_TASK_STEPS", "60")),
  /** Max agent-to-agent turns triggered by one user message (loop prevention) */
  maxAgentTurns: Number(env("MAX_AGENT_TURNS", "8")),

  /** Delegation (hierarchical multi-agent) */
  // How deep the delegation tree may go. 1 = flat (Lead → specialists). 2 = nested orchestrators.
  maxSpawnDepth: Number(env("MAX_SPAWN_DEPTH", "1")),
  // How many delegated sub-tasks run at once (keep under MAX_RUNNING_COMPUTERS).
  delegateConcurrency: Number(env("DELEGATE_CONCURRENCY", "2")),
  // Default per-sub-task timeout (seconds).
  delegateDefaultTimeoutSec: Number(env("DELEGATE_TIMEOUT_SEC", "300")),
  // Spawned specialists are permanent; their computer is stopped after this many idle minutes
  // (history + files persist). Shorter than the global idle stop below.
  specialistIdleStopMinutes: Number(env("SPECIALIST_IDLE_STOP_MINUTES", "10")),

  agentDesktopImage: env("AGENT_DESKTOP_IMAGE", "grokbot/agent-desktop:latest"),

  /** Code Guardian (repo-health reviewer). */
  // Create the permanent "Code Guardian" agent + skill + (disabled) routine on boot.
  codeGuardianEnabled: env("CODE_GUARDIAN", "0") === "1",
  // Default repo Code Guardian reviews (git URL or a path). Optional; a request can name another.
  codeGuardianRepo: env("CODE_GUARDIAN_REPO", ""),
  // Branch that a push webhook must target to trigger a review.
  codeGuardianBranch: env("CODE_GUARDIAN_BRANCH", "main"),
  // Shared secret for the inbound git webhook (POST /api/hooks/git). Empty = webhook disabled.
  gitWebhookSecret: env("GIT_WEBHOOK_SECRET", ""),

  /** Built web UI directory; when present it's served at "/" so the whole app runs on one port. */
  webDist: env("WEB_DIST", path.resolve(process.cwd(), "../web/dist")),
};

/** First configured developer key + a sensible default model. */
export function liveModelConfig(): { provider: Provider; model: string } | undefined {
  if (config.xaiApiKey) {
    const model = /deepseek/i.test(config.xaiBaseUrl) ? "deepseek-v4-flash" : PROVIDER_DEFAULT_MODELS.generic;
    return { provider: "generic", model };
  }
  if (config.anthropicApiKey) return { provider: "anthropic", model: PROVIDER_DEFAULT_MODELS.anthropic };
  if (config.openaiApiKey) return { provider: "openai", model: PROVIDER_DEFAULT_MODELS.openai };
  if (config.googleApiKey) return { provider: "google", model: PROVIDER_DEFAULT_MODELS.google };
  return undefined;
}

export function defaultModelFor(provider: Provider): string {
  if (provider === "generic" && /deepseek/i.test(config.xaiBaseUrl)) return "deepseek-v4-flash";
  return PROVIDER_DEFAULT_MODELS[provider];
}

export function ensureDataDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "screenshots"), { recursive: true });
}
