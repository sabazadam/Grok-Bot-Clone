#!/usr/bin/env python3
"""Action daemon for the Botbox agent computer.

Small stdlib-only HTTP server that exposes the display to the orchestrator:
screenshots, mouse/keyboard input (via xdotool), and shell execution.
It listens inside the container; the orchestrator reaches it through a
localhost-bound published port on the host.
"""

import json
import os
import shlex
import subprocess
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("ACTIOND_PORT", "39990"))
DISPLAY_ENV = {**os.environ, "DISPLAY": os.environ.get("DISPLAY", ":0")}
HOME = os.path.expanduser("~")
MAX_OUTPUT = 20000

SCROLL_BUTTONS = {"up": "4", "down": "5", "left": "6", "right": "7"}


def xdotool(*args: str) -> None:
    subprocess.run(["xdotool", *args], env=DISPLAY_ENV, check=True,
                   capture_output=True, timeout=30)


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def take_screenshot() -> bytes:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        path = f.name
    try:
        subprocess.run(["scrot", "-o", "-z", path], env=DISPLAY_ENV,
                       check=True, capture_output=True, timeout=30)
        with open(path, "rb") as f:
            return f.read()
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def handle_action(body: dict) -> dict:
    kind = body.get("type")
    if kind == "move":
        xdotool("mousemove", str(int(body["x"])), str(int(body["y"])))
    elif kind in ("click", "double_click", "right_click", "middle_click"):
        button = {"click": "1", "double_click": "1",
                  "right_click": "3", "middle_click": "2"}[kind]
        args = ["mousemove", str(int(body["x"])), str(int(body["y"]))]
        if kind == "double_click":
            args += ["click", "--repeat", "2", "--delay", "120", button]
        else:
            args += ["click", button]
        xdotool(*args)
    elif kind == "drag":
        xdotool("mousemove", str(int(body["x1"])), str(int(body["y1"])),
                "mousedown", "1")
        time.sleep(0.15)
        xdotool("mousemove", str(int(body["x2"])), str(int(body["y2"])))
        time.sleep(0.15)
        xdotool("mouseup", "1")
    elif kind == "scroll":
        button = SCROLL_BUTTONS.get(body.get("direction", "down"), "5")
        amount = str(clamp(int(body.get("amount", 3)), 1, 20))
        if "x" in body and "y" in body:
            xdotool("mousemove", str(int(body["x"])), str(int(body["y"])))
        xdotool("click", "--repeat", amount, "--delay", "60", button)
    elif kind == "type":
        text = str(body.get("text", ""))
        if text:
            xdotool("type", "--delay", "25", "--", text)
    elif kind == "key":
        keys = str(body.get("keys", "")).split()
        if keys:
            xdotool("key", "--delay", "60", "--", *keys)
    elif kind == "wait":
        time.sleep(clamp(float(body.get("seconds", 1)), 0, 15))
    elif kind == "launch":
        command = str(body.get("command", ""))
        if not command:
            raise ValueError("launch requires a command")
        subprocess.Popen(["bash", "-lc", command], env=DISPLAY_ENV, cwd=HOME,
                         start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        raise ValueError(f"unknown action type: {kind!r}")
    return {"ok": True}


def handle_exec(body: dict) -> dict:
    command = str(body.get("command", ""))
    if not command:
        raise ValueError("exec requires a command")
    timeout = clamp(float(body.get("timeout", 60)), 1, 600)
    cwd = body.get("cwd") or HOME
    try:
        proc = subprocess.run(["bash", "-lc", command], env=DISPLAY_ENV,
                              cwd=cwd, capture_output=True, timeout=timeout)
        return {
            "ok": True,
            "exit_code": proc.returncode,
            "stdout": proc.stdout.decode("utf-8", "replace")[-MAX_OUTPUT:],
            "stderr": proc.stderr.decode("utf-8", "replace")[-MAX_OUTPUT:],
        }
    except subprocess.TimeoutExpired as e:
        return {
            "ok": False,
            "error": f"command timed out after {timeout:.0f}s",
            "stdout": (e.stdout or b"").decode("utf-8", "replace")[-MAX_OUTPUT:],
            "stderr": (e.stderr or b"").decode("utf-8", "replace")[-MAX_OUTPUT:],
        }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep container logs quiet
        pass

    def _send_json(self, obj: dict, status: int = 200) -> None:
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"ok": True})
        elif self.path == "/screenshot":
            try:
                png = take_screenshot()
            except Exception as e:  # noqa: BLE001
                self._send_json({"error": f"screenshot failed: {e}"}, 500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(png)))
            self.end_headers()
            self.wfile.write(png)
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send_json({"error": "invalid JSON"}, 400)
            return
        try:
            if self.path == "/action":
                self._send_json(handle_action(body))
            elif self.path == "/exec":
                self._send_json(handle_exec(body))
            else:
                self._send_json({"error": "not found"}, 404)
        except subprocess.CalledProcessError as e:
            detail = (e.stderr or b"").decode("utf-8", "replace")[:500]
            self._send_json({"error": f"input failed: {detail}"}, 500)
        except (KeyError, TypeError, ValueError) as e:
            self._send_json({"error": str(e)}, 400)
        except Exception as e:  # noqa: BLE001
            self._send_json({"error": f"internal error: {e}"}, 500)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"actiond listening on :{PORT}", flush=True)
    server.serve_forever()
