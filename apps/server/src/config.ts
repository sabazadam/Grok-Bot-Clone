import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

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

  /** Max computer-use loop steps per task */
  maxTaskSteps: Number(env("MAX_TASK_STEPS", "60")),
  /** Max agent-to-agent turns triggered by one user message (loop prevention) */
  maxAgentTurns: Number(env("MAX_AGENT_TURNS", "8")),

  agentDesktopImage: env("AGENT_DESKTOP_IMAGE", "grokbot/agent-desktop:latest"),

  /** Built web UI directory; when present it's served at "/" so the whole app runs on one port. */
  webDist: env("WEB_DIST", path.resolve(process.cwd(), "../web/dist")),
};

export function ensureDataDirs(): void {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, "screenshots"), { recursive: true });
}
