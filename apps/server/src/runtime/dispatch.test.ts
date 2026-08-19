import { describe, it, expect } from "vitest";
import {
  chooseResponders,
  composeSkillPrompt,
  extractMentions,
  extractSkillInvocation,
  isStopCommand,
  mentionsEveryone,
} from "./dispatch.js";

const lead = { id: "lead", name: "Piper", isTeamLead: true };
const scout = { id: "scout", name: "Scout", isTeamLead: false };
const writer = { id: "writer", name: "Writer", isTeamLead: false };
const members = [lead, scout, writer];

describe("isStopCommand", () => {
  it("matches Grok Bot stop phrasing", () => {
    expect(isStopCommand("Stop now")).toBe(true);
    expect(isStopCommand("stop now!")).toBe(true);
    expect(isStopCommand("/stop")).toBe(true);
    expect(isStopCommand("cancel")).toBe(true);
    expect(isStopCommand("stop")).toBe(true);
  });

  it("does not treat task text as stop", () => {
    expect(isStopCommand("please stop the email from sending")).toBe(false);
    expect(isStopCommand("Stop the deploy and report back")).toBe(false);
  });
});

describe("chooseResponders", () => {
  it("direct chat always wakes the one agent", () => {
    expect(
      chooseResponders({ conversationKind: "direct", members: [scout], text: "hello", mentionedIds: [] }),
    ).toEqual(["scout"]);
  });

  it("group @mention targets that teammate", () => {
    expect(
      chooseResponders({
        conversationKind: "group",
        members,
        text: "@Scout research these accounts",
        mentionedIds: ["scout"],
      }),
    ).toEqual(["scout"]);
  });

  it("group @everyone wakes all members", () => {
    expect(
      chooseResponders({
        conversationKind: "group",
        members,
        text: "@everyone status check",
        mentionedIds: [],
      }),
    ).toEqual(["lead", "scout", "writer"]);
  });

  it("unmentioned group work goes to team leads", () => {
    expect(
      chooseResponders({
        conversationKind: "group",
        members,
        text: "Draft the launch plan",
        mentionedIds: [],
      }),
    ).toEqual(["lead"]);
  });

  it("falls back to everyone when the group has no lead", () => {
    expect(
      chooseResponders({
        conversationKind: "group",
        members: [scout, writer],
        text: "Draft the launch plan",
        mentionedIds: [],
      }),
    ).toEqual(["scout", "writer"]);
  });

  it("skill invocation wakes only members who have it enabled", () => {
    expect(
      chooseResponders({
        conversationKind: "group",
        members,
        text: "/Weekly account health",
        mentionedIds: [],
        skillId: "sk1",
        membersWithSkill: ["scout"],
      }),
    ).toEqual(["scout"]);
  });
});

describe("extractSkillInvocation", () => {
  const skills = [
    { id: "1", name: "Weekly account health" },
    { id: "2", name: "Health" },
  ];

  it("prefers the longest skill name", () => {
    const hit = extractSkillInvocation("/Weekly account health skip ACME", skills);
    expect(hit).toMatchObject({ skillId: "1", rest: "skip ACME" });
  });

  it("ignores ordinary messages", () => {
    expect(extractSkillInvocation("please run the weekly account health skill", skills)).toBeUndefined();
  });
});

describe("composeSkillPrompt", () => {
  it("embeds instructions and the extra request", () => {
    const text = composeSkillPrompt(
      { id: "1", name: "Weekly account health", description: "Portfolio review", instructions: "Pull CRM. Do not contact customers.", createdAt: 1 },
      "Skip ACME",
    );
    expect(text).toMatch(/Skill: Weekly account health/);
    expect(text).toMatch(/Pull CRM/);
    expect(text).toMatch(/Skip ACME/);
  });
});

describe("mentionsEveryone / extractMentions", () => {
  it("detects @everyone without treating it as an agent name", () => {
    expect(mentionsEveryone("hey @everyone stand by")).toBe(true);
    expect(extractMentions("hey @Scout and @Writer", members)).toEqual(expect.arrayContaining(["scout", "writer"]));
  });
});
