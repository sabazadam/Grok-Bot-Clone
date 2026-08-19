#!/usr/bin/env python3
"""
GrokBot agent-desktop actuator.

Tiny stdlib-only HTTP API that lets the host server operate this OS like a human:
mouse, keyboard, screenshots, shell. Runs as the non-root `agent` user inside the
container. NOT meant to be exposed beyond the loopback of the host machine.

Endpoints:
  GET  /health              -> {"ok": true, "resolution": "1280x800"}
  GET  /screenshot          -> image/png bytes
  POST /action              -> {"ok": true} | {"ok": false, "error": "..."}
                               body: normalized ComputerAction JSON (see shared/actions.ts)
  POST /exec                -> {"ok": bool, "exitCode": int, "output": "..."}
                               body: {"cmd": "...", "timeoutSec": 30}
"""
import json
import os
import random
import re
import signal
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DISPLAY = os.environ.get("DISPLAY", ":0")
PORT = int(os.environ.get("ACTUATOR_PORT", "8090"))
RESOLUTION = os.environ.get("RESOLUTION", "1280x800")
# Human-like input timing (subtle mouse paths, variable typing, realistic scroll). Set HUMANIZE=0 to
# get deterministic, instant input (useful for tests). Kept subtle so it isn't its own bot signature.
HUMANIZE = os.environ.get("HUMANIZE", "1") != "0"

ENV = {**os.environ, "DISPLAY": DISPLAY}
EXEC_LOCK = threading.Lock()
EXEC_PROC: subprocess.Popen | None = None


def kill_exec() -> bool:
    """Stop the in-flight /exec process group (Stop now)."""
    global EXEC_PROC
    with EXEC_LOCK:
        proc = EXEC_PROC
        EXEC_PROC = None
    if proc is None or proc.poll() is not None:
        return False
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except OSError:
            return False
    return True

# Common key aliases -> xdotool keysym names. Provider adapters send a variety of names.
KEY_ALIASES = {
    "enter": "Return", "return": "Return",
    "esc": "Escape", "escape": "Escape",
    "tab": "Tab", "space": "space",
    "backspace": "BackSpace", "delete": "Delete", "del": "Delete",
    "up": "Up", "down": "Down", "left": "Left", "right": "Right",
    "arrowup": "Up", "arrowdown": "Down", "arrowleft": "Left", "arrowright": "Right",
    "home": "Home", "end": "End",
    "pageup": "Page_Up", "pagedown": "Page_Down", "page_up": "Page_Up", "page_down": "Page_Down",
    "cmd": "super", "command": "super", "win": "super", "meta": "super",
    "control": "ctrl", "option": "alt",
    "capslock": "Caps_Lock", "printscreen": "Print",
    "f1": "F1", "f2": "F2", "f3": "F3", "f4": "F4", "f5": "F5", "f6": "F6",
    "f7": "F7", "f8": "F8", "f9": "F9", "f10": "F10", "f11": "F11", "f12": "F12",
}


def normalize_key(key: str) -> str:
    """Normalize a key or chord ("ctrl+shift+t", "Enter") to xdotool syntax."""
    parts = [p.strip() for p in key.replace(" ", "+").split("+") if p.strip()]
    out = []
    for p in parts:
        low = p.lower()
        out.append(KEY_ALIASES.get(low, p if len(p) > 1 else p))
    return "+".join(out)


def run(cmd: list, timeout: float = 15.0) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, env=ENV, capture_output=True, text=True, timeout=timeout)


def xdotool(*args: str) -> None:
    r = run(["xdotool", *args])
    if r.returncode != 0:
        raise RuntimeError(f"xdotool {' '.join(args[:2])} failed: {r.stderr.strip() or r.stdout.strip()}")


def get_clipboard() -> str:
    try:
        r = run(["xclip", "-selection", "clipboard", "-o"], timeout=5)
        return r.stdout if r.returncode == 0 else ""
    except Exception:  # noqa: BLE001
        return ""


def set_clipboard(text: str) -> bool:
    try:
        p = subprocess.run(["xclip", "-selection", "clipboard", "-i"], input=text, env=ENV, text=True, timeout=5)
        return p.returncode == 0
    except Exception:  # noqa: BLE001
        return False


def take_screenshot() -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        path = f.name
    try:
        r = run(["scrot", "-o", "-z", path])
        if r.returncode != 0:
            raise RuntimeError(f"scrot failed: {r.stderr.strip()}")
        with open(path, "rb") as fh:
            return fh.read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


SCROLL_BUTTONS = {"up": "4", "down": "5", "left": "6", "right": "7"}


def _cursor_pos() -> tuple[int, int] | None:
    try:
        r = run(["xdotool", "getmouselocation", "--shell"])
        loc = dict(line.split("=") for line in r.stdout.strip().splitlines() if "=" in line)
        return int(loc.get("X", 0)), int(loc.get("Y", 0))
    except Exception:  # noqa: BLE001
        return None


def human_move(x: int, y: int) -> None:
    """Move the cursor to (x, y). When HUMANIZE, glide along an eased path with tiny jitter instead of
    teleporting — this makes multi-step UI tasks land more reliably and looks less robotic."""
    x, y = int(x), int(y)
    if not HUMANIZE:
        xdotool("mousemove", "--sync", str(x), str(y))
        return
    start = _cursor_pos()
    if start is None:
        xdotool("mousemove", "--sync", str(x), str(y))
        return
    x0, y0 = start
    dist = ((x - x0) ** 2 + (y - y0) ** 2) ** 0.5
    steps = max(4, min(24, int(dist / 40) + 4))
    for i in range(1, steps):
        t = i / steps
        ease = 3 * t * t - 2 * t * t * t  # smoothstep ease-in-out
        nx = x0 + (x - x0) * ease + random.uniform(-1.5, 1.5)
        ny = y0 + (y - y0) * ease + random.uniform(-1.5, 1.5)
        xdotool("mousemove", "--sync", str(int(round(nx))), str(int(round(ny))))
        time.sleep(random.uniform(0.006, 0.02))
    xdotool("mousemove", "--sync", str(x), str(y))  # settle exactly on target


def human_pause(lo: float = 0.04, hi: float = 0.12) -> None:
    time.sleep(random.uniform(lo, hi) if HUMANIZE else 0.03)


def type_text(text: str) -> None:
    """Type text with variable per-key delay and small inter-word pauses when HUMANIZE."""
    if not text:
        return
    if not HUMANIZE:
        xdotool("type", "--delay", "20", "--", text)
        return
    for part in re.split(r"(\s+)", text):
        if not part:
            continue
        xdotool("type", "--delay", str(random.randint(45, 100)), "--", part)
        time.sleep(random.uniform(0.02, 0.12))


def do_action(a: dict) -> dict:
    t = a.get("type")
    if t == "screenshot":
        pass  # caller fetches /screenshot; treated as a no-op here
    elif t in ("left_click", "double_click", "triple_click", "right_click", "middle_click"):
        button = {"right_click": "3", "middle_click": "2"}.get(t, "1")
        repeat = {"double_click": "2", "triple_click": "3"}.get(t, "1")
        human_move(int(a["x"]), int(a["y"]))
        human_pause()  # brief dwell before pressing, like a person settling on the target
        xdotool("click", "--repeat", repeat, "--delay", "80", button)
    elif t == "mouse_move":
        human_move(int(a["x"]), int(a["y"]))
    elif t == "left_click_drag":
        human_move(int(a["startX"]), int(a["startY"]))
        xdotool("mousedown", "1")
        human_pause(0.1, 0.2)
        human_move(int(a["x"]), int(a["y"]))
        human_pause(0.1, 0.2)
        xdotool("mouseup", "1")
    elif t == "scroll":
        x, y = a.get("x"), a.get("y")
        if x is not None and y is not None:
            human_move(int(x), int(y))
        button = SCROLL_BUTTONS.get(a.get("direction", "down"), "5")
        amount = max(1, min(int(a.get("amount", 3)), 30))
        if HUMANIZE:
            # wheel notches in small bursts with slight pauses, rather than one instant blast
            for _ in range(amount):
                xdotool("click", button)
                time.sleep(random.uniform(0.03, 0.09))
        else:
            xdotool("click", "--repeat", str(amount), "--delay", "60", button)
    elif t == "type":
        type_text(str(a.get("text", "")))
    elif t == "key":
        xdotool("key", "--", normalize_key(str(a["key"])))
    elif t == "hold_key":
        key = normalize_key(str(a["key"]))
        xdotool("keydown", "--", key)
        time.sleep(min(float(a.get("durationMs", 500)) / 1000.0, 5.0))
        xdotool("keyup", "--", key)
    elif t == "wait":
        time.sleep(min(float(a.get("durationMs", 1000)) / 1000.0, 30.0))
    elif t == "cursor_position":
        r = run(["xdotool", "getmouselocation", "--shell"])
        loc = dict(line.split("=") for line in r.stdout.strip().splitlines() if "=" in line)
        return {"ok": True, "cursor": {"x": int(loc.get("X", 0)), "y": int(loc.get("Y", 0))}}
    else:
        return {"ok": False, "error": f"unknown action type: {t}"}
    return {"ok": True}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet
        pass

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length == 0:
            return {}
        return json.loads(self.rfile.read(length).decode())

    def do_GET(self):
        if self.path.startswith("/health"):
            self._json(200, {"ok": True, "resolution": RESOLUTION, "humanize": HUMANIZE})
        elif self.path.startswith("/clipboard"):
            self._json(200, {"ok": True, "text": get_clipboard()})
        elif self.path.startswith("/screenshot"):
            try:
                png = take_screenshot()
                self.send_response(200)
                self.send_header("Content-Type", "image/png")
                self.send_header("Content-Length", str(len(png)))
                self.end_headers()
                self.wfile.write(png)
            except Exception as e:  # noqa: BLE001
                self._json(500, {"ok": False, "error": str(e)})
        else:
            self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        try:
            body = self._read_body()
        except Exception as e:  # noqa: BLE001
            self._json(400, {"ok": False, "error": f"bad json: {e}"})
            return
        if self.path.startswith("/action"):
            try:
                self._json(200, do_action(body))
            except Exception as e:  # noqa: BLE001
                self._json(200, {"ok": False, "error": str(e)})
        elif self.path.startswith("/clipboard"):
            self._json(200, {"ok": set_clipboard(str(body.get("text", "")))})
        elif self.path.startswith("/abort"):
            self._json(200, {"ok": True, "killed": kill_exec()})
        elif self.path.startswith("/exec"):
            cmd = body.get("cmd", "")
            timeout = min(float(body.get("timeoutSec", 30)), 600.0)
            if not cmd:
                self._json(400, {"ok": False, "error": "cmd required"})
                return
            global EXEC_PROC
            try:
                proc = subprocess.Popen(
                    ["bash", "-lc", cmd],
                    env=ENV,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    cwd="/home/agent",
                    start_new_session=True,
                )
                with EXEC_LOCK:
                    EXEC_PROC = proc
                try:
                    out, _ = proc.communicate(timeout=timeout)
                except subprocess.TimeoutExpired:
                    kill_exec()
                    self._json(200, {"ok": False, "exitCode": -1, "output": f"timed out after {timeout}s"})
                    return
                with EXEC_LOCK:
                    if EXEC_PROC is proc:
                        EXEC_PROC = None
                if proc.returncode is None or proc.returncode < 0:
                    self._json(200, {"ok": False, "exitCode": -1, "output": (out or "")[-20000:] + "\n(aborted)"})
                    return
                self._json(200, {"ok": proc.returncode == 0, "exitCode": proc.returncode, "output": (out or "")[-20000:]})
            except Exception as e:  # noqa: BLE001
                kill_exec()
                self._json(200, {"ok": False, "exitCode": -1, "output": str(e)})
        else:
            self._json(404, {"ok": False, "error": "not found"})


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"actuator listening on :{PORT} display={DISPLAY} resolution={RESOLUTION}", flush=True)
    server.serve_forever()
