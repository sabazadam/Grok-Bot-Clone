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
echo "Then open http://localhost:5173"
