#!/usr/bin/env bash
# Register / start Memory Engine under PM2 (same pattern as dash & media).
#
#   bash ~/pocket-server/scripts/pm2-memory-engine.sh
#   pm2 list          # expect: memory
#   pm2 logs memory
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_DIR="${MEMORY_ENGINE_DIR:-$(dirname "$REPO_ROOT")/memory-engine}"
RUNNER="$SCRIPT_DIR/run-memory-engine.sh"
NAME="memory"

die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

command -v pm2 >/dev/null 2>&1 || die "pm2 not found — install with: npm install -g pm2"
command -v proot-distro >/dev/null 2>&1 || die "proot-distro missing — run setup-memory-engine.sh first"
[ -x "$RUNNER" ] || chmod +x "$RUNNER"

# NOTE: .venv/bin/python is a symlink into the Ubuntu guest.
# From Termux it looks "broken", so do NOT test -f/-x on it.
# pyvenv.cfg / activate are real files created by setup.
if [ ! -f "$ENGINE_DIR/.venv/pyvenv.cfg" ] && [ ! -f "$ENGINE_DIR/.venv/bin/activate" ]; then
  die "Python venv missing. Run first: bash $SCRIPT_DIR/setup-memory-engine.sh"
fi

# Drop any previous process with the same name
pm2 delete "$NAME" 2>/dev/null || true

# Keep process alive under PM2; runner enters proot Ubuntu then serves
pm2 start "$RUNNER" \
  --name "$NAME" \
  --interpreter bash \
  -- serve

pm2 save

echo ""
echo "Memory Engine registered with PM2 as '$NAME'"
echo "  pm2 list"
echo "  pm2 logs $NAME --lines 50"
echo "  Open http://127.0.0.1:8765"
echo ""
echo "If status is errored, check: pm2 logs $NAME"
echo "Setup may still be incomplete (pip packages). Verify with:"
echo "  bash $SCRIPT_DIR/run-memory-engine.sh status"
