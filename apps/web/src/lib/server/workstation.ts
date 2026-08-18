import { execFile } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Bot, DesktopWindow, FsEntry, WorkstationState } from "../types";
import {
  clampCursor,
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  isSafeShell,
  screenCaption,
} from "../logic";

const execFileAsync = promisify(execFile);

export function workstationHome(dataDir: string, botId: string): string {
  return path.join(dataDir, "workstations", botId, "home");
}

function windowFor(
  kind: DesktopWindow["kind"],
  title: string,
  x: number,
  y: number,
): DesktopWindow {
  return {
    id: kind,
    kind,
    title,
    x,
    y,
    w: kind === "terminal" ? 620 : 720,
    h: kind === "files" ? 420 : 460,
    focused: kind === "files",
    minimized: kind !== "files",
  };
}

function listHome(home: string): FsEntry[] {
  mkdirSync(home, { recursive: true });
  return readdirSync(home).map((name) => {
    const full = path.join(home, name);
    const stat = statSync(full);
    return {
      name,
      kind: stat.isDirectory() ? "dir" : "file",
      size: stat.isDirectory() ? undefined : stat.size,
    };
  });
}

export function createWorkstation(bot: Bot, dataDir: string): WorkstationState {
  const home = workstationHome(dataDir, bot.id);
  mkdirSync(home, { recursive: true });
  writeFileSync(
    path.join(home, "README.md"),
    `# ${bot.name}'s home\n\nRole: ${bot.title}\n\nThis folder belongs to this Bot only.\nDrop files you want ${bot.name} to use here.\n`,
  );
  writeFileSync(
    path.join(home, "notes.md"),
    `# Working notes\n\n- Standing rules live in the Bot profile.\n- Shared drop box is ../../shared (ask before using).\n`,
  );

  return {
    botId: bot.id,
    width: DESKTOP_WIDTH,
    height: DESKTOP_HEIGHT,
    cursor: { x: 180, y: 160 },
    wallpaper: bot.color,
    windows: [
      windowFor("files", `${bot.name} — Home`, 80, 70),
      windowFor("browser", "Browser", 220, 90),
      windowFor("terminal", "Terminal", 300, 160),
    ],
    files: listHome(home),
    browser: {
      url: "about:home",
      title: "Home",
      body: `${bot.name} browser\n\nThis workstation is isolated. Open a URL or ask ${bot.name} to browse.`,
      loading: false,
    },
    terminal: {
      cwd: home,
      lines: [`${bot.name} os ready.`, `home: ${home}`, ""],
      input: "",
    },
    lastAction: "boot",
    takeover: false,
    updatedAt: new Date().toISOString(),
  };
}

function focusWindow(state: WorkstationState, kind: DesktopWindow["kind"]): void {
  for (const win of state.windows) {
    if (win.kind === kind) {
      win.minimized = false;
      win.focused = true;
    } else {
      win.focused = false;
    }
  }
}

function refreshFiles(state: WorkstationState, dataDir: string): void {
  state.files = listHome(workstationHome(dataDir, state.botId));
}

export function captionFor(bot: Bot, state: WorkstationState): string {
  return screenCaption({
    botName: bot.name,
    cursor: state.cursor,
    windows: state.windows,
    files: state.files,
    browser: state.browser,
    terminal: state.terminal,
    lastAction: state.lastAction,
  });
}

export function moveMouse(state: WorkstationState, x: number, y: number): void {
  state.cursor = clampCursor(x, y);
  state.lastAction = `mouse → ${state.cursor.x},${state.cursor.y}`;
  state.updatedAt = new Date().toISOString();
}

export function clickDesktop(state: WorkstationState): string {
  const { x, y } = state.cursor;
  const hit = [...state.windows]
    .reverse()
    .find(
      (win) =>
        !win.minimized &&
        x >= win.x &&
        x <= win.x + win.w &&
        y >= win.y &&
        y <= win.y + 36,
    );
  if (hit) {
    focusWindow(state, hit.kind);
    state.lastAction = `click titlebar ${hit.kind}`;
    state.updatedAt = new Date().toISOString();
    return state.lastAction;
  }
  const dockY = state.height - 56;
  if (y >= dockY) {
    if (x >= 36 && x < 96) {
      focusWindow(state, "files");
      state.lastAction = "open files";
    } else if (x >= 104 && x < 164) {
      focusWindow(state, "browser");
      state.lastAction = "open browser";
    } else if (x >= 172 && x < 232) {
      focusWindow(state, "terminal");
      state.lastAction = "open terminal";
    }
    state.updatedAt = new Date().toISOString();
    return state.lastAction;
  }
  state.lastAction = `click ${x},${y}`;
  state.updatedAt = new Date().toISOString();
  return state.lastAction;
}

export function openApp(state: WorkstationState, kind: DesktopWindow["kind"]): void {
  focusWindow(state, kind);
  const win = state.windows.find((item) => item.kind === kind);
  if (win) {
    state.cursor = clampCursor(win.x + 40, win.y + 18);
  }
  state.lastAction = `open ${kind}`;
  state.updatedAt = new Date().toISOString();
}

export function typeText(state: WorkstationState, text: string): void {
  const focused = state.windows.find((win) => win.focused && !win.minimized);
  if (focused?.kind === "terminal") {
    state.terminal.input += text;
  } else if (focused?.kind === "browser") {
    if (!state.browser.url || state.browser.url === "about:home") {
      state.browser.url = text;
    } else if (!state.browser.url.includes(" ")) {
      state.browser.url += text;
    } else {
      state.browser.body += text;
    }
  }
  state.lastAction = `type ${text.slice(0, 32)}`;
  state.updatedAt = new Date().toISOString();
}

export function pressKey(state: WorkstationState, key: string, dataDir: string): void {
  const focused = state.windows.find((win) => win.focused && !win.minimized);
  if (key === "Enter" && focused?.kind === "terminal") {
    const command = state.terminal.input;
    state.terminal.lines.push(`$ ${command}`);
    state.terminal.input = "";
    state.lastAction = `enter terminal`;
    void command;
  }
  if (key === "Enter" && focused?.kind === "browser") {
    state.lastAction = `navigate ${state.browser.url}`;
  }
  if (key === "Escape") {
    state.takeover = false;
  }
  refreshFiles(state, dataDir);
  state.updatedAt = new Date().toISOString();
}

export function readHomeFile(dataDir: string, botId: string, name: string): string {
  const home = workstationHome(dataDir, botId);
  const target = path.resolve(home, name);
  if (!target.startsWith(path.resolve(home))) {
    throw new Error("Path escapes this Bot's home");
  }
  return readFileSync(target, "utf8");
}

export function writeHomeFile(
  state: WorkstationState,
  dataDir: string,
  name: string,
  content: string,
): void {
  const home = workstationHome(dataDir, state.botId);
  const target = path.resolve(home, name);
  if (!target.startsWith(path.resolve(home))) {
    throw new Error("Path escapes this Bot's home");
  }
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
  refreshFiles(state, dataDir);
  openApp(state, "files");
  state.lastAction = `write ${name}`;
}

export async function runShell(
  state: WorkstationState,
  command: string,
): Promise<string> {
  if (!isSafeShell(command)) {
    const message = "Blocked unsafe command";
    state.terminal.lines.push(message);
    state.lastAction = message;
    return message;
  }
  openApp(state, "terminal");
  state.terminal.lines.push(`$ ${command}`);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-lc", command], {
      cwd: state.terminal.cwd,
      timeout: 8000,
      maxBuffer: 64_000,
    });
    const output = (stdout || stderr || "(no output)").toString().slice(0, 4000);
    state.terminal.lines.push(...output.split("\n").slice(0, 40));
    state.lastAction = `shell ${command}`;
    return output;
  } catch (error) {
    const message = error instanceof Error ? error.message : "command failed";
    state.terminal.lines.push(message);
    state.lastAction = `shell fail`;
    return message;
  }
}

export async function browse(
  state: WorkstationState,
  url: string,
): Promise<string> {
  openApp(state, "browser");
  state.browser.loading = true;
  state.browser.url = url;
  state.cursor = clampCursor(360, 120);
  try {
    if (url.startsWith("about:")) {
      state.browser.title = "Home";
      state.browser.body = "Workstation home";
      state.browser.loading = false;
      return state.browser.body;
    }
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only http(s) URLs are allowed");
    }
    const response = await fetch(parsed.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "ForgeWorkstation/0.1" },
      signal: AbortSignal.timeout(8000),
    });
    const html = await response.text();
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000);
    state.browser.title = titleMatch?.[1]?.trim() || parsed.hostname;
    state.browser.body = text || "(empty page)";
    state.browser.loading = false;
    state.lastAction = `browse ${parsed.hostname}`;
    return `${state.browser.title}\n${state.browser.body.slice(0, 800)}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : "browse failed";
    state.browser.title = "Error";
    state.browser.body = message;
    state.browser.loading = false;
    state.lastAction = "browse failed";
    return message;
  }
}

export function setTakeover(state: WorkstationState, on: boolean): void {
  state.takeover = on;
  state.lastAction = on ? "human takeover" : "return control";
  state.updatedAt = new Date().toISOString();
}
