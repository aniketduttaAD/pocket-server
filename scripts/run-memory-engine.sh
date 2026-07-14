#!/usr/bin/env bash
# Run Memory Engine inside proot Ubuntu.
# Usage: run-memory-engine.sh [serve|ingest|status|search "query"|...]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_DIR="$REPO_ROOT/memory-engine"

DISTRO="ubuntu"
PHOTOS_TERMUX="${PHOTOS_TERMUX:-$HOME/storage/dcim}"
PHOTOS_GUEST="/root/photos"
APP_GUEST="/root/app"
ENGINE_GUEST="$APP_GUEST/memory-engine"

CMD="${1:-serve}"
shift || true

# Quote remaining args safely for the inner shell
EXTRA=""
for a in "$@"; do
  EXTRA="$EXTRA $(printf '%q' "$a")"
done

exec proot-distro login "$DISTRO" \
  --bind "$PHOTOS_TERMUX:$PHOTOS_GUEST" \
  --bind "$REPO_ROOT:$APP_GUEST" \
  -- bash -lc "cd $(printf '%q' "$ENGINE_GUEST") && source .venv/bin/activate && exec python -m memory_engine $(printf '%q' "$CMD")$EXTRA"
