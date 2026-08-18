#!/bin/bash
# Boots the agent computer: virtual display, window manager, VNC server, action daemon.
set -e

export DISPLAY=:0
GEOMETRY="${SCREEN_GEOMETRY:-1280x800x24}"

Xvfb :0 -screen 0 "$GEOMETRY" -nolisten tcp &

for _ in $(seq 1 100); do
  if xdpyinfo >/dev/null 2>&1; then break; fi
  sleep 0.1
done

xsetroot -solid "#171a24" || true
openbox &

x11vnc -display :0 -forever -shared -nopw -rfbport 5900 -quiet -xkb -noxdamage &

exec python3 /usr/local/bin/actiond.py
