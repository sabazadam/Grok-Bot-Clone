import Docker from 'dockerode';
import { getAgent, updateAgent } from './db.js';
import { broadcastAgent } from './events.js';
import type { AgentRow } from './types.js';

const IMAGE = process.env.BOTBOX_COMPUTER_IMAGE ?? 'botbox-computer:latest';
const docker = new Docker();

const containerName = (agentId: string) => `botbox-agent-${agentId}`;
const volumeName = (agentId: string) => `botbox-home-${agentId}`;

export async function checkDocker(): Promise<void> {
  try {
    await docker.ping();
  } catch {
    throw new Error('Docker daemon is not reachable. Botbox needs Docker to run agent computers.');
  }
  try {
    await docker.getImage(IMAGE).inspect();
  } catch {
    throw new Error(`Docker image "${IMAGE}" not found. Build it with: npm run build:computer`);
  }
}

function mappedPort(info: Docker.ContainerInspectInfo, containerPort: string): number | null {
  const bindings = info.NetworkSettings.Ports?.[containerPort];
  const port = bindings?.[0]?.HostPort;
  return port ? Number(port) : null;
}

async function waitForActiond(port: number, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('agent computer did not become ready in time');
}

function setState(agentId: string, state: AgentRow['computerState'], extra?: Parameters<typeof updateAgent>[1]) {
  const row = updateAgent(agentId, { computerState: state, ...extra });
  if (row) broadcastAgent(row);
  return row;
}

/** Boot (or reuse) the container for an agent. Safe to call when already running. */
export async function startComputer(agentId: string): Promise<AgentRow> {
  const agent = getAgent(agentId);
  if (!agent) throw new Error(`agent ${agentId} not found`);
  if (agent.computerState === 'running' && agent.actionPort) {
    try {
      await waitForActiond(agent.actionPort, 3000);
      return agent;
    } catch {
      // fall through and re-create
    }
  }

  setState(agentId, 'starting');
  try {
    let container = docker.getContainer(containerName(agentId));
    let exists = true;
    try {
      const info = await container.inspect();
      if (!info.State.Running) await container.start();
    } catch {
      exists = false;
    }

    if (!exists) {
      container = await docker.createContainer({
        name: containerName(agentId),
        Image: IMAGE,
        Hostname: agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 32) || 'agent',
        ExposedPorts: { '5900/tcp': {}, '39990/tcp': {} },
        HostConfig: {
          Binds: [`${volumeName(agentId)}:/home/agent`],
          PortBindings: {
            '5900/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }],
            '39990/tcp': [{ HostIp: '127.0.0.1', HostPort: '' }],
          },
          ShmSize: 512 * 1024 * 1024,
          Memory: 2 * 1024 * 1024 * 1024,
          RestartPolicy: { Name: 'unless-stopped' },
        },
      });
      await container.start();
    }

    const info = await container.inspect();
    const actionPort = mappedPort(info, '39990/tcp');
    const vncPort = mappedPort(info, '5900/tcp');
    if (!actionPort || !vncPort) throw new Error('failed to resolve mapped ports');

    await waitForActiond(actionPort);
    return setState(agentId, 'running', {
      containerId: info.Id,
      actionPort,
      vncPort,
    })!;
  } catch (err) {
    setState(agentId, 'error');
    throw err;
  }
}

export async function stopComputer(agentId: string): Promise<void> {
  try {
    await docker.getContainer(containerName(agentId)).stop({ t: 5 });
  } catch {
    // already stopped or missing
  }
  setState(agentId, 'stopped');
}

/** Recreate the container (fresh OS) while keeping the /home/agent volume. */
export async function restartComputer(agentId: string): Promise<AgentRow> {
  await removeContainer(agentId);
  return startComputer(agentId);
}

async function removeContainer(agentId: string): Promise<void> {
  const container = docker.getContainer(containerName(agentId));
  try {
    await container.remove({ force: true });
  } catch {
    // missing is fine
  }
}

/** Remove container and volume permanently (agent deletion). */
export async function destroyComputer(agentId: string): Promise<void> {
  await removeContainer(agentId);
  try {
    await docker.getVolume(volumeName(agentId)).remove();
  } catch {
    // missing is fine
  }
}

// ---------- actiond client ----------

function actionBase(agent: AgentRow): string {
  if (agent.computerState !== 'running' || !agent.actionPort) {
    throw new Error('agent computer is not running');
  }
  return `http://127.0.0.1:${agent.actionPort}`;
}

export async function takeScreenshot(agent: AgentRow): Promise<Buffer> {
  const res = await fetch(`${actionBase(agent)}/screenshot`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`screenshot failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

export async function performAction(agent: AgentRow, action: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${actionBase(agent)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(action),
    signal: AbortSignal.timeout(45_000),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || !body.ok) throw new Error(body.error ?? `action failed (${res.status})`);
}

export interface ExecResult {
  ok: boolean;
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
}

export async function execCommand(
  agent: AgentRow,
  command: string,
  timeoutSec = 60,
): Promise<ExecResult> {
  const res = await fetch(`${actionBase(agent)}/exec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, timeout: timeoutSec }),
    signal: AbortSignal.timeout((timeoutSec + 15) * 1000),
  });
  return (await res.json()) as ExecResult;
}
