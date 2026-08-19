import { describe, it, expect } from "vitest";
import type { ToolInvocation } from "../models/types.js";
import {
  handoffCaption,
  isSandboxWork,
  isSilentReply,
  shouldPostAssistantNarration,
  shouldPostToolToChat,
} from "./report.js";

const click: ToolInvocation = { id: "1", tool: "computer", action: { type: "left_click", x: 10, y: 20 } };
const type: ToolInvocation = { id: "2", tool: "computer", action: { type: "type", text: "hello" } };
const shot: ToolInvocation = { id: "3", tool: "computer", action: { type: "screenshot" } };
const bash: ToolInvocation = { id: "4", tool: "bash", command: "ls ~/workspace" };
const memory: ToolInvocation = { id: "5", tool: "update_memory", memoryKind: "fact", content: "note" };
const say: ToolInvocation = { id: "6", tool: "send_message", text: "Need you to take over for 2FA." };
const dm: ToolInvocation = { id: "7", tool: "send_message_to_agent", toAgentName: "Scout", text: "Research these 5 accounts." };
const done: ToolInvocation = { id: "8", tool: "task_complete", summary: "Drafts are in workspace/outbox." };
const ask: ToolInvocation = { id: "9", tool: "request_approval", description: "send the email", reason: "external" };

describe("sandbox vs chat", () => {
  it("treats computer, bash, and memory as sandbox work", () => {
    expect([click, type, shot, bash, memory].every(isSandboxWork)).toBe(true);
    expect([say, dm, done, ask].some(isSandboxWork)).toBe(false);
  });

  it("never posts model narration into chat", () => {
    expect(shouldPostAssistantNarration("I'll click the search box now")).toBe(false);
    expect(shouldPostAssistantNarration("Looking at the page")).toBe(false);
    expect(shouldPostAssistantNarration(undefined)).toBe(false);
  });

  it("posts only explicit communication tools to chat", () => {
    expect(shouldPostToolToChat(click)).toBe(false);
    expect(shouldPostToolToChat(type)).toBe(false);
    expect(shouldPostToolToChat(shot)).toBe(false);
    expect(shouldPostToolToChat(bash)).toBe(false);
    expect(shouldPostToolToChat(memory)).toBe(false);
    expect(shouldPostToolToChat(done)).toBe(false);
    expect(shouldPostToolToChat(ask)).toBe(false);
    expect(shouldPostToolToChat(say)).toBe(true);
    expect(shouldPostToolToChat(dm)).toBe(true);
    expect(
      shouldPostToolToChat({ id: "s", tool: "save_skill", name: "X", description: "", instructions: "do it" }),
    ).toBe(true);
    expect(
      shouldPostToolToChat({ id: "a", tool: "create_agent", name: "Scout", roleTitle: "Researcher", instructions: "research" }),
    ).toBe(true);
  });
});

describe("silent replies", () => {
  it("suppresses ACK / empty so teammate no-ops do not spam chat", () => {
    expect(isSilentReply("")).toBe(true);
    expect(isSilentReply("   ")).toBe(true);
    expect(isSilentReply("ACK")).toBe(true);
    expect(isSilentReply("ack")).toBe(true);
    expect(isSilentReply("ACK.")).toBe(true);
    expect(isSilentReply("Ack!")).toBe(true);
  });

  it("keeps real results visible", () => {
    expect(isSilentReply("Done. Drafts are in workspace/outbox.")).toBe(false);
    expect(isSilentReply("Need your password for Gmail.")).toBe(false);
    expect(isSilentReply("ok I finished the research")).toBe(false);
  });
});

describe("handoff caption", () => {
  it("shows the teammate handoff in the sender's chat", () => {
    expect(handoffCaption("Scout", "Research these 5 accounts.")).toBe("→ @Scout: Research these 5 accounts.");
  });
});
