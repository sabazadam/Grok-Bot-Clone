/**
 * ComputerManager — lifecycle of per-agent OS containers via Docker.
 *
 * Each agent owns exactly one container ("its computer"), built from the
 * grokbot/agent-desktop image, with:
 *   - a named volume for /home/agent (files, browser sessions survive restarts)
 *   - noVNC (live desktop view) and the actuator API published on 127.0.0.1
 *     with dynamically assigned host ports
 */
import Docker from "dockerode";
import { setTimeout as sleep } from "node:timers/promises";
import type { ComputerAction, ComputerInfo } from "@grokbot/shared";
import { config } from "../config.js";

export interface ExecResult {
  ok: boolean;
  exitCode: number;
  output: string;
}

export interface ActionResponse {
  ok: boolean;
  error?: string;
  cursor?: { x: number; y: number };
}

function parseMemory(s: string): number {
  const m = /^(\d+(?:\.\d+)?)([kmg]?)b?$/i.exec(s.trim());
  if (!m) return 2 * 1024 ** 3;
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  return Math.round(n * (unit === "k" ? 1024 : unit === "m" ? 1024 ** 2 : unit === "g" ? 1024 ** 3 : 1));
}

const CONTAINER_PREFIX = "agentos-";
const VOLUME_SUFFIX = "-home";

export class ComputerManager {
  private docker: Docker;
  /** agentId -> last actuator interaction, for idle stop */
  private lastUsed = new Map<string, number>();

  constructor(socketPath: string = config.dockerSocket) {
    this.docker = new Docker({ socketPath });
  }

  containerName(agentId: string): string {
    return `${CONTAINER_PREFIX}${agentId}`;
  }
  volumeName(agentId: string): string {
    return `${CONTAINER_PREFIX}${agentId}${VOLUME_SUFFIX}`;
  }

  async dockerAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  async imageAvailable(): Promise<boolean> {
    try {
      await this.docker.getImage(config.agentDesktopImage).inspect();
      return true;
    } catch {
      return false;
    }
  }

  /** Inspect current state; returns "none" if the container doesn't exist. */
  async status(agentId: string): Promise<ComputerInfo> {
    try {
      const c = this.docker.getContainer(this.containerName(agentId));
      const info = await c.inspect();
      const ports = info.NetworkSettings.Ports ?? {};
      const hostPort = (key: string): number | null => {
        const bindings = ports[key];
        const p = bindings?.[0]?.HostPort;
        return p ? Number(p) : null;
      };
      return {
        containerId: info.Id,
        state: info.State.Running ? "running" : "stopped",
        novncPort: hostPort("6080/tcp"),
        actuatorPort: hostPort("8090/tcp"),
        resolution: config.computerResolution,
      };
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) {
        return { containerId: null, state: "none", novncPort: null, actuatorPort: null, resolution: config.computerResolution };
      }
      throw err;
    }
  }

  async runningCount(): Promise<number> {
    const list = await this.docker.listContainers({
      filters: { name: [CONTAINER_PREFIX] },
    });
    return list.filter((c) => c.Names.some((n) => n.replace(/^\//, "").startsWith(CONTAINER_PREFIX))).length;
  }

  /**
   * Ensure the agent's computer exists and is running; returns its info.
   * Creates container + volume on first call. Waits for the actuator to be healthy.
   */
  async ensureRunning(agentId: string): Promise<ComputerInfo> {
    if (!(await this.imageAvailable())) {
      throw new Error(
        `Docker image "${config.agentDesktopImage}" not found. Build it with: npm run image:build`,
      );
    }
    let info = await this.status(agentId);

    if (info.state === "none") {
      const running = await this.runningCount();
      if (running >= config.maxRunningComputers) {
        throw new Error(
          `Max concurrent agent computers reached (${config.maxRunningComputers}). Stop another agent's computer or raise MAX_RUNNING_COMPUTERS.`,
        );
      }
      await this.docker.createVolume({ Name: this.volumeName(agentId) }).catch(() => undefined);
      await this.docker.createContainer({
        name: this.containerName(agentId),
        Image: config.agentDesktopImage,
        Env: [`RESOLUTION=${config.computerResolution}`],
        Labels: { "grokbot.agent-id": agentId },
        HostConfig: {
          Memory: parseMemory(config.computerMemory),
          NanoCpus: 2_000_000_000,
          ShmSize: 512 * 1024 ** 2,
          Binds: [`${this.volumeName(agentId)}:/home/agent`],
          PortBindings: {
            "6080/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }],
            "8090/tcp": [{ HostIp: "127.0.0.1", HostPort: "" }],
          },
          SecurityOpt: ["no-new-privileges"],
        },
      });
    }

    info = await this.status(agentId);
    if (info.state !== "running") {
      const running = await this.runningCount();
      if (running >= config.maxRunningComputers) {
        throw new Error(
          `Max concurrent agent computers reached (${config.maxRunningComputers}).`,
        );
      }
      await this.docker.getContainer(this.containerName(agentId)).start();
      info = await this.status(agentId);
    }

    await this.waitHealthy(agentId, info);
    this.touch(agentId);
    return info;
  }

  private async waitHealthy(agentId: string, info: ComputerInfo, timeoutMs = 90_000): Promise<void> {
    if (!info.actuatorPort) throw new Error("actuator port not assigned");
    const url = `http://127.0.0.1:${info.actuatorPort}/health`;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          // also wait for X display to accept screenshots
          const shot = await fetch(`http://127.0.0.1:${info.actuatorPort}/screenshot`, {
            signal: AbortSignal.timeout(5000),
          });
          if (shot.ok) return;
        }
      } catch {
        /* not up yet */
      }
      await sleep(1500);
    }
    throw new Error(`agent computer for ${agentId} did not become healthy within ${timeoutMs / 1000}s`);
  }

  async stop(agentId: string): Promise<void> {
    const info = await this.status(agentId);
    if (info.state === "running") {
      await this.docker.getContainer(this.containerName(agentId)).stop({ t: 5 });
    }
  }

  async restart(agentId: string): Promise<ComputerInfo> {
    await this.stop(agentId);
    return this.ensureRunning(agentId);
  }

  /** Destroy container and (optionally) its home volume. */
  async destroy(agentId: string, removeData: boolean): Promise<void> {
    const info = await this.status(agentId);
    if (info.state !== "none") {
      const c = this.docker.getContainer(this.containerName(agentId));
      await c.remove({ force: true, v: false });
    }
    if (removeData) {
      await this.docker.getVolume(this.volumeName(agentId)).remove().catch(() => undefined);
    }
    this.lastUsed.delete(agentId);
  }

  // ── Actuator proxying ────────────────────────────────────────────────

  private async actuatorPort(agentId: string): Promise<number> {
    const info = await this.status(agentId);
    if (info.state !== "running" || !info.actuatorPort) {
      throw new Error(`agent computer for ${agentId} is not running`);
    }
    return info.actuatorPort;
  }

  touch(agentId: string): void {
    this.lastUsed.set(agentId, Date.now());
  }

  async screenshot(agentId: string): Promise<Buffer> {
    const port = await this.actuatorPort(agentId);
    this.touch(agentId);
    const res = await fetch(`http://127.0.0.1:${port}/screenshot`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`screenshot failed: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async act(agentId: string, action: ComputerAction): Promise<ActionResponse> {
    const port = await this.actuatorPort(agentId);
    this.touch(agentId);
    const res = await fetch(`http://127.0.0.1:${port}/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
      signal: AbortSignal.timeout(60_000),
    });
    return (await res.json()) as ActionResponse;
  }

  /**
   * Write the browser configuration file the in-container wrapper sources, so an
   * agent's stealth toggle / UA / timezone / locale take effect without recreating
   * the container.
   */
  async syncBrowserConfig(
    agentId: string,
    opts: { stealth: boolean; userAgent: string; timezone: string; locale: string },
  ): Promise<void> {
    const esc = (s: string) => s.replace(/'/g, "'\\''");
    const content = [
      `STEALTH=${opts.stealth ? "1" : "0"}`,
      `USER_AGENT='${esc(opts.userAgent)}'`,
      `TZ='${esc(opts.timezone)}'`,
      `LOCALE='${esc(opts.locale)}'`,
    ].join("\n");
    const cmd = `mkdir -p ~/.config/grokbot && cat > ~/.config/grokbot/browser.env <<'GBEOF'\n${content}\nGBEOF`;
    try {
      await this.exec(agentId, cmd, 15);
    } catch {
      /* best-effort; wrapper falls back to stealth-on defaults */
    }
  }

  async exec(agentId: string, cmd: string, timeoutSec = 60): Promise<ExecResult> {
    const port = await this.actuatorPort(agentId);
    this.touch(agentId);
    const res = await fetch(`http://127.0.0.1:${port}/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd, timeoutSec }),
      signal: AbortSignal.timeout((timeoutSec + 15) * 1000),
    });
    return (await res.json()) as ExecResult;
  }

  /** Stop computers idle for longer than the configured threshold. Returns stopped agent ids. */
  async stopIdle(activeAgentIds: Set<string>): Promise<string[]> {
    if (config.computerIdleStopMinutes <= 0) return [];
    const cutoff = Date.now() - config.computerIdleStopMinutes * 60_000;
    const stopped: string[] = [];
    for (const [agentId, ts] of this.lastUsed) {
      if (ts < cutoff && !activeAgentIds.has(agentId)) {
        try {
          await this.stop(agentId);
          this.lastUsed.delete(agentId);
          stopped.push(agentId);
        } catch {
          /* ignore */
        }
      }
    }
    return stopped;
  }
}

export const computerManager = new ComputerManager();
