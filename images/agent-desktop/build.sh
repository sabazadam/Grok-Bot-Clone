#!/bin/bash
# Build the GrokBot agent-desktop image for the current architecture.
# Usage: bash images/agent-desktop/build.sh [--multi] [--no-camoufox]
#   --multi        build+push multi-arch (arm64+amd64) — requires buildx + a registry
#   --no-camoufox  skip bundling Camoufox (smaller image, no network fetch — offline/CI)
#
# By default the image bundles Camoufox (a Firefox-based anti-detect browser, ~150-250 MB), so the
# build needs network access. Chromium remains the default engine; Camoufox is selected per agent.
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="${AGENT_DESKTOP_IMAGE:-grokbot/agent-desktop:latest}"

MULTI=0
CAMOUFOX=1
for arg in "$@"; do
  case "$arg" in
    --multi) MULTI=1 ;;
    --no-camoufox) CAMOUFOX=0 ;;
  esac
done

BUILD_ARGS=(--build-arg "INSTALL_CAMOUFOX=$CAMOUFOX")

if [[ "$MULTI" == "1" ]]; then
  docker buildx build --platform linux/arm64,linux/amd64 "${BUILD_ARGS[@]}" -t "$IMAGE" --push .
else
  docker build "${BUILD_ARGS[@]}" -t "$IMAGE" .
fi
echo "Built $IMAGE"
