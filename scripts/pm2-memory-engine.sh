#!/usr/bin/env bash
# Register / start Memory Engine under PM2 (same pattern as dash & media).
#
#   bash ~/pocket-server/scripts/pm2-memory-engine.sh
#   pm2 list          # expect: memory
#   pm2 logs memory
#   pm2 restart memory
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNNER="$SCRIPT_DIR/run-memory-engine.sh"
NAME="memory"

die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v pm2 >/dev/null 2>&1 || die "pm2 not found — install with: npm install -g pm2"
[ -x "$RUNNER" ] || chmod +x "$RUNNER"
[ -f "$REPO_ROOT/memory-engine/.venv/bin/python" ] || \
  die "Python venv missing. Run first: bash $SCRIPT_DIR/setup-memory-engine.sh"

# Drop any previous process with the same name
pm2 delete "$NAME" 2>/dev/null || true

# interpreter none + bash script — PM2 keeps it alive and restarts on crash
pm2 start "$RUNNER" \
  --name "$NAME" \
  --interpreter bash \
  -- serve

pm2 save

echo ""
echo "Memory Engine registered with PM2 as '$NAME'"
echo "  pm2 list"
echo "  pm2 logs $NAME"
echo "  Open http://127.0.0.1:8765"
echo "  Public: https://memory.<your-domain>"
