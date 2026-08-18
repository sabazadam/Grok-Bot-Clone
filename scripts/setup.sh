#!/bin/bash
# GrokBot one-time setup — designed for macOS (Apple Silicon Mac mini) and Linux.
set -euo pipefail
cd "$(dirname "$0")/.."

bold() { printf "\033[1m%s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }
fail() { printf "  \033[31m✗\033[0m %s\n" "$1"; exit 1; }

bold "GrokBot setup"

# 1. Node
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -e 'console.log(process.versions.node.split(".")[0])')
  if [ "$NODE_MAJOR" -ge 20 ]; then ok "Node $(node --version)"; else fail "Node >= 20 required (found $(node --version)). Install from https://nodejs.org or: brew install node"; fi
else
  fail "Node.js not found. Install it first: brew install node"
fi

# 2. Docker
if ! command -v docker >/dev/null 2>&1; then
  fail "Docker not found. Install Docker Desktop (https://docker.com/products/docker-desktop) or OrbStack (https://orbstack.dev), then re-run."
fi
if ! docker info >/dev/null 2>&1; then
  fail "Docker is installed but not running. Start Docker Desktop / OrbStack, then re-run."
fi
ok "Docker is running ($(docker --version | cut -d, -f1))"

# 3. Dependencies
bold "Installing dependencies…"
npm install
ok "npm dependencies installed"

# 4. Agent OS image
bold "Building the agent desktop image (first build takes a few minutes)…"
bash images/agent-desktop/build.sh
ok "grokbot/agent-desktop:latest built"

# 5. .env
if [ ! -f .env ]; then
  cp .env.example .env
  warn "Created .env — add your API key(s): ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_API_KEY / XAI_API_KEY"
else
  ok ".env exists"
fi

# set_env KEY VALUE — update KEY in .env (or append if missing)
set_env() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then
    # portable in-place edit (macOS + Linux)
    local tmp
    tmp="$(mktemp)"
    grep -vE "^${key}=" .env > "$tmp"
    printf '%s=%s\n' "$key" "$val" >> "$tmp"
    mv "$tmp" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

# 5b. Access mode — how will you reach GrokBot?
bold "How will you use GrokBot?"
echo "  1) This device only — run and use it all on this machine (default)."
echo "  2) Server + commander — this machine is the server; drive it from another"
echo "     device (e.g. your MacBook) over your private Tailscale network."
ACCESS_CHOICE="1"
if [ -t 0 ]; then
  read -r -p "Choose [1/2] (default 1): " ACCESS_CHOICE || true
fi
ACCESS_CHOICE="${ACCESS_CHOICE:-1}"

if [ "$ACCESS_CHOICE" = "2" ]; then
  # Detect a Tailscale IPv4 (100.x.y.z) so we bind only to the tailnet, not the whole LAN.
  TS_IP=""
  if command -v tailscale >/dev/null 2>&1; then
    TS_IP="$(tailscale ip -4 2>/dev/null | head -n1 || true)"
  fi
  if [ -z "$TS_IP" ]; then
    for cand in /Applications/Tailscale.app/Contents/MacOS/Tailscale; do
      [ -x "$cand" ] && TS_IP="$("$cand" ip -4 2>/dev/null | head -n1 || true)" && break
    done
  fi
  if [ -n "$TS_IP" ]; then
    set_env ACCESS_MODE "server"
    set_env WEB_HOST "$TS_IP"
    set_env COMPUTER_BIND_HOST "$TS_IP"
    ok "Server mode: bound to your Tailscale IP ${TS_IP} (reachable only on your tailnet)."
    echo "     From your MacBook (connected to the same tailnet), open: http://${TS_IP}:5173"
    ACCESS_URL="http://${TS_IP}:5173"
  else
    set_env ACCESS_MODE "server"
    set_env WEB_HOST "0.0.0.0"
    set_env COMPUTER_BIND_HOST "0.0.0.0"
    warn "Tailscale IP not found. Bound to 0.0.0.0 (ALL interfaces)."
    warn "Install/'up' Tailscale and re-run to restrict access to your tailnet, or ensure a firewall protects this machine."
    echo "     From your other device, open: http://<this-machine-tailscale-or-LAN-ip>:5173"
    ACCESS_URL="http://<this-machine-ip>:5173"
  fi
else
  set_env ACCESS_MODE "local"
  set_env WEB_HOST "127.0.0.1"
  set_env COMPUTER_BIND_HOST "127.0.0.1"
  ok "Single-device mode: everything stays on this machine (localhost only)."
  ACCESS_URL="http://localhost:5173"
fi

# 6. Resources
if [ "$(uname)" = "Darwin" ]; then
  MEM_GB=$(( $(sysctl -n hw.memsize) / 1073741824 ))
else
  MEM_GB=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1048576 ))
fi
SUGGESTED=$(( MEM_GB / 4 ))
[ "$SUGGESTED" -lt 1 ] && SUGGESTED=1
ok "System RAM: ${MEM_GB}GB — each agent computer uses ~1-2GB (MAX_RUNNING_COMPUTERS default 4, suggested max here: ${SUGGESTED})"

bold "Done! Start GrokBot with:  npm run dev"
echo "Then open ${ACCESS_URL:-http://localhost:5173}"
echo "(Re-run this script anytime to change how you access GrokBot.)"
