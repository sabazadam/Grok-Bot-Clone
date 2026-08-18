import assert from "node:assert/strict";
import test from "node:test";
import {
  clampCursor,
  collaborationRequested,
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  initialsFromName,
  isSafeShell,
  looksLikeHardStop,
  parseMentions,
  providerNeedsKey,
  resolveMentionedBots,
  screenCaption,
} from "./logic";
import type { Bot } from "./types";

function bot(name: string): Bot {
  return {
    id: name,
    name,
    title: "Role",
    description: "",
    color: "#fff",
    initials: "X",
    provider: "rehearsal",
    model: "rehearsal",
    allowCollaboration: true,
    hidden: false,
    pinned: false,
    createdAt: "",
    updatedAt: "",
    status: "idle",
    memory: [],
  };
}

test("initialsFromName", () => {
  assert.equal(initialsFromName("Atlas"), "AT");
  assert.equal(initialsFromName("Chief of Staff"), "CO");
  assert.equal(initialsFromName("  "), "B");
});

test("clampCursor stays on the desktop", () => {
  assert.deepEqual(clampCursor(-10, 9000), { x: 0, y: DESKTOP_HEIGHT - 1 });
  assert.deepEqual(clampCursor(640, 360), { x: 640, y: 360 });
  assert.deepEqual(clampCursor(DESKTOP_WIDTH + 8, -1), {
    x: DESKTOP_WIDTH - 1,
    y: 0,
  });
});

test("mentions and collaboration", () => {
  assert.deepEqual(parseMentions("ask @Scout and @everyone"), [
    "Scout",
    "everyone",
  ]);
  assert.equal(collaborationRequested("please talk to Scout"), true);
  assert.equal(collaborationRequested("summarize this note"), false);
  const resolved = resolveMentionedBots("hi @Scout", [
    bot("Atlas"),
    bot("Scout"),
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].name, "Scout");
});

test("hard-stop detector", () => {
  assert.equal(looksLikeHardStop("send the email now"), "send_external");
  assert.equal(looksLikeHardStop("purchase 12 licenses"), "purchase");
  assert.equal(looksLikeHardStop("draft a summary"), null);
});

test("shell safety", () => {
  assert.equal(isSafeShell("ls -la"), true);
  assert.equal(isSafeShell("rm -rf /"), false);
});

test("provider key requirement", () => {
  assert.equal(providerNeedsKey("rehearsal"), false);
  assert.equal(providerNeedsKey("openai"), true);
});

test("screen caption includes cursor and files", () => {
  const text = screenCaption({
    botName: "Atlas",
    cursor: { x: 10, y: 20 },
    windows: [
      { kind: "files", title: "Home", focused: true, minimized: false },
    ],
    files: [{ name: "brief.md" }],
    browser: { url: "about:home", title: "Home", body: "hello" },
    terminal: { cwd: "/home", lines: ["$ ls"] },
    lastAction: "open files",
  });
  assert.match(text, /Atlas/);
  assert.match(text, /10,20/);
  assert.match(text, /brief.md/);
});
