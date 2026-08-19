import { describe, it, expect, beforeEach, vi } from "vitest";

// Avoid pulling the real runner (Docker) when triggering; we only assert enqueue + bookkeeping.
vi.mock("./runner.js", () => ({ runAgentTask: vi.fn(async () => {}) }));

import { useTestDb } from "../db.js";
import * as store from "../store.js";
import {
  ensureCodeGuardian,
  triggerCodeGuardianReview,
  parsePushPayload,
  CODE_GUARDIAN_NAME,
  CODE_GUARDIAN_SKILL,
  CODE_GUARDIAN_ROUTINE,
} from "./codeGuardian.js";

beforeEach(() => {
  useTestDb();
});

describe("ensureCodeGuardian", () => {
  it("creates a review_only agent + skill + disabled routine, and is idempotent", () => {
    const first = ensureCodeGuardian();
    const agent = store.getAgent(first.agentId)!;
    expect(agent.name).toBe(CODE_GUARDIAN_NAME);
    expect(agent.toolPolicy).toBe("review_only");

    const skill = store.getSkillByName(CODE_GUARDIAN_SKILL)!;
    expect(skill).toBeTruthy();
    expect(store.agentHasSkill(agent.id, skill.id)).toBe(true);

    const routines = store.listRoutines(agent.id);
    const routine = routines.find((r) => r.name === CODE_GUARDIAN_ROUTINE)!;
    expect(routine).toBeTruthy();
    expect(routine.enabled).toBe(false); // disabled by default

    // idempotent: running again doesn't duplicate
    const second = ensureCodeGuardian();
    expect(second.agentId).toBe(first.agentId);
    expect(store.listAgents().filter((a) => a.name === CODE_GUARDIAN_NAME)).toHaveLength(1);
    expect(store.listRoutines(agent.id).filter((r) => r.name === CODE_GUARDIAN_ROUTINE)).toHaveLength(1);
  });
});

describe("triggerCodeGuardianReview", () => {
  it("returns false when Code Guardian doesn't exist", () => {
    expect(triggerCodeGuardianReview({ reason: "x" })).toBe(false);
  });

  it("enqueues a review task in Code Guardian's chat once set up", () => {
    const { agentId } = ensureCodeGuardian();
    const ok = triggerCodeGuardianReview({ repo: "https://example.com/repo.git", reason: "push to main" });
    expect(ok).toBe(true);
    const conv = store.directConversationForAgent(agentId)!;
    const msgs = store.listMessages(conv.id);
    expect(msgs.some((m) => m.sender.kind === "system" && /review started/i.test(m.text))).toBe(true);
  });
});

describe("parsePushPayload", () => {
  it("extracts branch + repo from a GitHub push payload", () => {
    const { branch, repo } = parsePushPayload({
      ref: "refs/heads/main",
      repository: { clone_url: "https://github.com/o/r.git", full_name: "o/r" },
    });
    expect(branch).toBe("main");
    expect(repo).toBe("https://github.com/o/r.git");
  });

  it("returns undefined branch for a non-push body", () => {
    expect(parsePushPayload({}).branch).toBeUndefined();
  });
});
