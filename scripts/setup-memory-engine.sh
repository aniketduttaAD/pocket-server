#!/usr/bin/env bash
#
# Memory Engine setup for phone-server (Termux + proot Ubuntu).
#
# Prerequisites:
#   git clone ... ~/phone-server
#   Photos at ~/storage/dcim  (year folders: 2011/, 2012/, ...)
#   data/ is bundled under ~/phone-server/memory-engine/data
#
# Run from Termux:
#   bash ~/phone-server/scripts/setup-memory-engine.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_SRC="$REPO_ROOT/memory-engine"
DISTRO="ubuntu"

PHOTOS_TERMUX="$HOME/storage/dcim"
ENGINE_TERMUX="$HOME/phone-server/memory-engine"

PHOTOS_GUEST="/root/photos"
ENGINE_GUEST="/root/phone-server/memory-engine"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Phase 2: inside Ubuntu guest
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--inside" ]; then
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST"

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

  cat <<EOF

============================================================
Memory Engine ready inside phone-server.

Start (from Termux):
  bash ~/phone-server/scripts/run-memory-engine.sh serve

Open http://127.0.0.1:8765
Public URL (if tunnel configured): https://memory.<your-domain>
============================================================
EOF
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase 1: Termux
# ---------------------------------------------------------------------------
[ -d "/data/data/com.termux" ] || die "Run this inside Termux on Android."
[ -d "$ENGINE_SRC" ] || die "Missing $ENGINE_SRC — clone the full phone-server repo."
[ -f "$ENGINE_SRC/requirements.txt" ] || die "Incomplete memory-engine bundle."

if [ ! -f "$ENGINE_SRC/data/memory.db" ]; then
  printf '\033[1;33mWARNING: no data/memory.db — copy indexed data/ before setup.\033[0m\n'
fi

log "Storage access (tap Allow if prompted)"
termux-setup-storage || true
[ -d "$PHOTOS_TERMUX" ] || printf '\033[1;33mWARNING: %s not found — put photos there first.\033[0m\n' "$PHOTOS_TERMUX"

log "Syncing memory-engine to ~/phone-server/memory-engine"
mkdir -p "$HOME/phone-server"
rsync -a --delete \
  --exclude '.venv' --exclude '__pycache__' --exclude 'node_modules' \
  "$ENGINE_SRC/" "$ENGINE_TERMUX/"

log "Installing proot-distro + Ubuntu"
pkg update -y
pkg install -y proot-distro rsync
proot-distro install "$DISTRO" 2>/dev/null || echo "Ubuntu guest already installed."

log "Provisioning Ubuntu guest"
proot-distro login "$DISTRO" \
  --bind "$PHOTOS_TERMUX:$PHOTOS_GUEST" \
  --bind "$HOME/phone-server:/root/phone-server" \
  -- bash "/root/phone-server/scripts/setup-memory-engine.sh" --inside
