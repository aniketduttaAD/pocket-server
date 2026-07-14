#!/usr/bin/env bash
#
# Memory Engine setup (Termux + proot Ubuntu).
# Works for any clone name: ~/pocket-server, ~/phone-server, etc.
#
# Prerequisites:
#   Photos at ~/storage/dcim  (year folders: 2011/, 2012/, ...)
#   Indexed data at <repo>/memory-engine/data/memory.db
#
# Run from Termux:
#   bash ~/pocket-server/scripts/setup-memory-engine.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_DIR="$REPO_ROOT/memory-engine"
DISTRO="ubuntu"

PHOTOS_TERMUX="${PHOTOS_TERMUX:-$HOME/storage/dcim}"

# Stable guest paths (independent of folder name on the phone)
PHOTOS_GUEST="/root/photos"
APP_GUEST="/root/app"
ENGINE_GUEST="$APP_GUEST/memory-engine"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Phase 2: inside Ubuntu guest
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--inside" ]; then
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST (bind mount failed)"

  log "Installing system packages (apt)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential cmake pkg-config \
    ffmpeg libgl1 libglib2.0-0 git curl

  log "Creating Python virtual environment"
  python3 -m venv .venv
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install --upgrade pip wheel setuptools

  log "Installing Python dependencies (slow on phone — be patient)"
  pip install -r requirements.txt

  log "Activating phone configuration"
  cp config.phone.yaml config.yaml

  log "Relocating photo paths to $PHOTOS_GUEST"
  python scripts/relocate_paths.py --photos-root "$PHOTOS_GUEST"

  log "Verifying engine"
  python -m memory_engine status || true

  cat <<'EOF'

============================================================
Memory Engine ready.

From Termux (outside proot), register with PM2:
  bash ~/pocket-server/scripts/pm2-memory-engine.sh

Then manage like other services:
  pm2 list
  pm2 logs memory
  pm2 restart memory

Open http://127.0.0.1:8765
Public: https://memory.<your-domain>
============================================================
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase 1: Termux
# ---------------------------------------------------------------------------
[ -d "/data/data/com.termux" ] || die "Run this inside Termux on Android."
[ -d "$ENGINE_DIR" ] || die "Missing $ENGINE_DIR"
[ -f "$ENGINE_DIR/requirements.txt" ] || die "Incomplete memory-engine bundle at $ENGINE_DIR"

if [ ! -f "$ENGINE_DIR/data/memory.db" ]; then
  die "Missing $ENGINE_DIR/data/memory.db
Copy the Mac's memory-engine/data/ folder here first (DB + models + vectors).
Example from Mac:
  rsync -avz --progress \".../phone-server/memory-engine/data/\" \\
    phone:~/pocket-server/memory-engine/data/"
fi

log "Repo root: $REPO_ROOT"
log "Engine:    $ENGINE_DIR"
log "Photos:    $PHOTOS_TERMUX"

log "Storage access (tap Allow if prompted)"
termux-setup-storage || true
[ -d "$PHOTOS_TERMUX" ] || printf '\033[1;33mWARNING: %s not found — put year folders there first.\033[0m\n' "$PHOTOS_TERMUX"

log "Installing proot-distro + Ubuntu"
pkg update -y
pkg install -y proot-distro rsync
proot-distro install "$DISTRO" 2>/dev/null || echo "Ubuntu guest already installed."

log "Provisioning Ubuntu guest (bind $REPO_ROOT -> $APP_GUEST)"
proot-distro login "$DISTRO" \
  --bind "$PHOTOS_TERMUX:$PHOTOS_GUEST" \
  --bind "$REPO_ROOT:$APP_GUEST" \
  -- bash "$APP_GUEST/scripts/setup-memory-engine.sh" --inside
