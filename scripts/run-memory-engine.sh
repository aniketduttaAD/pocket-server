#!/usr/bin/env bash
# Start Memory Engine inside proot Ubuntu (phone-server).
# Usage: run-memory-engine.sh [serve|ingest|status|search "query"]
set -euo pipefail

CMD="${1:-serve}"
shift || true
DISTRO="ubuntu"
PHOTOS_TERMUX="$HOME/storage/dcim"
ENGINE_TERMUX="$HOME/phone-server/memory-engine"
PHOTOS_GUEST="/root/photos"
ENGINE_GUEST="/root/phone-server/memory-engine"

exec proot-distro login "$DISTRO" \
  --bind "$PHOTOS_TERMUX:$PHOTOS_GUEST" \
  --bind "$HOME/phone-server:/root/phone-server" \
  -- bash -lc "cd $ENGINE_GUEST && source .venv/bin/activate && python -m memory_engine $CMD $*"
