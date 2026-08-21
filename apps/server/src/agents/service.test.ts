import { describe, it, expect } from "vitest";
import { nextProvisionStatus, type ProvisionPhase } from "./service.js";
import type { AgentStatus } from "@grokbot/shared";

const PHASES: ProvisionPhase[] = ["begin", "ready", "failed"];
const ACTIVE: AgentStatus[] = ["working", "waiting_approval"];

describe("nextProvisionStatus", () => {
  it("never clobbers an in-flight task", () => {
    for (const status of ACTIVE) {
      for (const phase of PHASES) {
        expect(nextProvisionStatus(status, phase)).toBeUndefined();
      }
    }
  });

  it("marks a quiet agent as starting, then idle or error", () => {
    for (const status of ["off", "idle", "error", "starting"] as AgentStatus[]) {
      expect(nextProvisionStatus(status, "begin")).toBe("starting");
      expect(nextProvisionStatus(status, "ready")).toBe("idle");
      expect(nextProvisionStatus(status, "failed")).toBe("error");
    }
  });
});
