/**
 * GrokBot desktop (Electron) main process.
 *
 * Two modes (chosen on first run, changeable in Settings):
 *   - "local":  launch the GrokBot server on this machine, then show its UI.
 *   - "remote": connect to a GrokBot server running elsewhere (e.g. your Mac mini
 *               over Tailscale) — this app is just the window ("commander").
 *
 * The local server runs via your system Node from your GrokBot install directory
 * (which already has dependencies + the built agent image), so we avoid bundling
 * native modules into the app.
 */
import { app, BrowserWindow, Menu, dialog, shell, ipcMain } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import http from "node:http";

interface Settings {
  mode: "local" | "remote" | null;
  remoteUrl: string;
  repoPath: string; // GrokBot install dir used to launch the local server
  localPort: number;
}

// Pin the app name so userData (settings) lives in a stable folder in dev and packaged builds.
app.setName("GrokBot");
const settingsPath = () => path.join(app.getPath("userData"), "settings.json");

function defaultRepoPath(): string {
  // In dev the app runs from apps/desktop; the repo root is two levels up.
  // When packaged, default to the folder the app was built from (best effort) or empty.
  const guess = path.resolve(__dirname, "../../.."); // apps/desktop/dist -> repo root
  return fs.existsSync(path.join(guess, "apps", "server")) ? guess : "";
}

function loadSettings(): Settings {
  const defaults: Settings = { mode: null, remoteUrl: "", repoPath: defaultRepoPath(), localPort: 8484 };
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    return { ...defaults, ...raw };
  } catch {
    return defaults;
  }
}

function saveSettings(s: Settings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

let win: BrowserWindow | null = null;
let serverProc: ChildProcess | null = null;

function waitForHealth(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) resolve(true);
        else retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) resolve(false);
      else setTimeout(tick, 1000);
    };
    tick();
  });
}

function startLocalServer(s: Settings): { ok: boolean; error?: string } {
  if (!s.repoPath || !fs.existsSync(path.join(s.repoPath, "apps", "server"))) {
    return { ok: false, error: "GrokBot install folder not found. Set it in Settings (the folder containing apps/server)." };
  }
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(s.localPort),
    HOST: "127.0.0.1",
    // Read the API keys / settings from the install's root .env explicitly.
    GROKBOT_ENV: path.join(s.repoPath, ".env"),
  };
  // In a packaged app, serve the UI bundled inside the app so local mode works even
  // if the repo's web build is absent. In dev, the server uses the repo's apps/web/dist.
  if (app.isPackaged) {
    env.WEB_DIST = path.join(process.resourcesPath, "web");
  }
  serverProc = spawn(npm, ["run", "start", "-w", "apps/server"], {
    cwd: s.repoPath,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  serverProc.on("error", (err) => {
    dialog.showErrorBox("GrokBot server failed to start", String(err));
  });
  return { ok: true };
}

function stopLocalServer(): void {
  if (serverProc && !serverProc.killed) {
    try {
      serverProc.kill();
    } catch {
      /* ignore */
    }
  }
  serverProc = null;
}

async function launch(): Promise<void> {
  const s = loadSettings();

  if (!s.mode) {
    createWindow("about:blank");
    openSettingsWindow(true);
    return;
  }

  if (s.mode === "remote") {
    if (!s.remoteUrl) {
      createWindow("about:blank");
      openSettingsWindow(true);
      return;
    }
    createWindow(s.remoteUrl);
    return;
  }

  // local
  const url = `http://127.0.0.1:${s.localPort}`;
  const started = startLocalServer(s);
  if (!started.ok) {
    createWindow("about:blank");
    dialog.showErrorBox("Can't start local server", started.error ?? "unknown error");
    openSettingsWindow(true);
    return;
  }
  createWindow("about:blank");
  const healthy = await waitForHealth(`${url}/health`, 60_000);
  if (healthy) {
    win?.loadURL(url);
  } else {
    dialog.showErrorBox(
      "GrokBot server didn't come up",
      "The local server didn't respond in time. Check that Docker and Node are installed and try again from Settings.",
    );
    openSettingsWindow(true);
  }
}

function createWindow(url: string): void {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "GrokBot",
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  // Open target=_blank / external links in the OS browser, keep app navigation in-app.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: "deny" };
  });
  if (url && url !== "about:blank") win.loadURL(url);
  else win.loadFile(path.join(__dirname, "..", "renderer", "loading.html")).catch(() => undefined);
  win.on("closed", () => {
    win = null;
  });
}

let settingsWin: BrowserWindow | null = null;
function openSettingsWindow(firstRun = false): void {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }
  settingsWin = new BrowserWindow({
    width: 520,
    height: 560,
    title: firstRun ? "Welcome to GrokBot" : "GrokBot Settings",
    parent: win ?? undefined,
    modal: false,
    resizable: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  settingsWin.loadFile(path.join(__dirname, "..", "renderer", "settings.html")).catch(() => undefined);
  settingsWin.on("closed", () => {
    settingsWin = null;
  });
}

// ── IPC from the settings page ──
ipcMain.handle("grokbot:getSettings", () => loadSettings());
ipcMain.handle("grokbot:saveSettings", async (_e, partial: Partial<Settings>) => {
  const next = { ...loadSettings(), ...partial };
  saveSettings(next);
  // apply immediately
  stopLocalServer();
  settingsWin?.close();
  await launch();
  return next;
});
ipcMain.handle("grokbot:pickFolder", async () => {
  const res = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return res.canceled ? null : res.filePaths[0];
});

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "GrokBot",
      submenu: [
        { role: "about" },
        { label: "Settings…", accelerator: "CmdOrCtrl+,", click: () => openSettingsWindow(false) },
        { type: "separator" },
        { role: "hide" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => win?.webContents.reload() },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "editMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  buildMenu();
  void launch();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void launch();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", stopLocalServer);
