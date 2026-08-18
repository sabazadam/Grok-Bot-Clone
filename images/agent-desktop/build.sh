#!/bin/bash
# Build the GrokBot agent-desktop image for the current architecture.
# Usage: bash images/agent-desktop/build.sh [--multi]
#   --multi  build+push multi-arch (arm64+amd64) — requires buildx + a registry
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${AGENT_DESKTOP_IMAGE:-grokbot/agent-desktop:latest}"

if [[ "${1:-}" == "--multi" ]]; then
  docker buildx build --platform linux/arm64,linux/amd64 -t "$IMAGE" --push .
else
  docker build -t "$IMAGE" .
fi
echo "Built $IMAGE"
