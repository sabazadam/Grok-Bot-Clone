/**
 * ComputerBackend — the abstraction the runtime uses to operate an agent's computer, independent of
 * HOW that computer is hosted. Today the only implementation is DockerComputerBackend
 * (see manager.ts, class ComputerManager). This interface is the seam for a future
 * "My Machines / host computer" backend (e.g. SSH to a Mac mini): implement these methods against
 * the host and the runner/service code works unchanged.
 *
 * Out of scope for now: an actual host backend. This is the design boundary only.
 */
import type { ComputerAction, ComputerInfo } from "@grokbot/shared";

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

export interface BrowserSyncOptions {
  stealth: boolean;
  userAgent: string;
  timezone: string;
  locale: string;
  engine?: string;
  camouConfig?: string;
}

export interface ComputerBackend {
  // availability
  dockerAvailable(): Promise<boolean>;
  imageAvailable(): Promise<boolean>;
  // lifecycle
  status(agentId: string): Promise<ComputerInfo>;
  ensureRunning(agentId: string): Promise<ComputerInfo>;
  stop(agentId: string): Promise<void>;
  restart(agentId: string): Promise<ComputerInfo>;
  destroy(agentId: string, removeData: boolean): Promise<void>;
  // operation
  screenshot(agentId: string): Promise<Buffer>;
  act(agentId: string, action: ComputerAction, signal?: AbortSignal): Promise<ActionResponse>;
  exec(agentId: string, cmd: string, timeoutSec?: number, signal?: AbortSignal): Promise<ExecResult>;
  abortExec(agentId: string): Promise<void>;
  syncBrowserConfig(agentId: string, opts: BrowserSyncOptions): Promise<void>;
  copyToWorkspace(agentId: string, hostFile: string, destName: string): Promise<void>;
  copyFileOut(agentId: string, containerPath: string): Promise<{ buffer: Buffer; name: string }>;
  // fleet management
  runningCount(): Promise<number>;
  runningAgentIds(): Promise<string[]>;
  evictIdle(protectedIds: Set<string>): Promise<string | undefined>;
  reapOrphans(knownAgentIds: string[]): Promise<string[]>;
  hydrateLastUsed(): Promise<void>;
  stopIdle(activeAgentIds: Set<string>, minutesFor?: (agentId: string) => number): Promise<string[]>;
  touch(agentId: string): void;
}
