#!/usr/bin/env bash
#
# Memory Engine setup (Termux + proot Ubuntu) — phone-safe, resumable.
#
# Termux often gets KILLED by Android when memory spikes (looks like
# "Termux closed"). Always run inside tmux + wake-lock.
#
#   bash ~/pocket-server/scripts/setup-memory-engine.sh
#
# Or step-by-step:
#   bash ~/pocket-server/scripts/setup-memory-engine.sh termux
#   bash ~/pocket-server/scripts/setup-memory-engine.sh ubuntu
#   bash ~/pocket-server/scripts/setup-memory-engine.sh apt
#   bash ~/pocket-server/scripts/setup-memory-engine.sh pip
#   bash ~/pocket-server/scripts/setup-memory-engine.sh finish
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENGINE_DIR="$REPO_ROOT/memory-engine"
DISTRO="ubuntu"
LOG_DIR="$HOME/logs"
LOG_FILE="$LOG_DIR/memory-engine-setup.log"

PHOTOS_TERMUX="${PHOTOS_TERMUX:-$HOME/storage/dcim}"
PHOTOS_GUEST="/root/photos"
APP_GUEST="/root/app"
ENGINE_GUEST="$APP_GUEST/memory-engine"

PHASE="${1:-all}"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; echo "[$(date '+%H:%M:%S')] $*" >>"$LOG_FILE"; }
die()  { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; echo "ERROR: $*" >>"$LOG_FILE"; exit 1; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }

mkdir -p "$LOG_DIR"
touch "$LOG_FILE"

# ---------------------------------------------------------------------------
# Survive Android killing the Termux UI: force tmux + wake-lock
# ---------------------------------------------------------------------------
ensure_tmux() {
  if [ -n "${TMUX:-}" ] || [ "${MEMORY_ENGINE_NO_TMUX:-}" = "1" ]; then
    return 0
  fi
  if ! command -v tmux >/dev/null 2>&1; then
    pkg install -y tmux || true
  fi
  if ! command -v tmux >/dev/null 2>&1; then
    echo "WARNING: tmux not available — install with: pkg install tmux"
    echo "Continuing without tmux (Termux may still get killed by Android)."
    return 0
  fi
  log "Re-launching inside tmux session 'memory-setup' (survives Termux UI close)"
  echo "  Detach anytime: Ctrl+b then d"
  echo "  Re-attach later: tmux attach -t memory-setup"
  echo "  Log file: $LOG_FILE"
  sleep 2
  # Keep the tmux pane open even if setup fails (so you can read the error)
  exec tmux new-session -A -s memory-setup \
    "MEMORY_ENGINE_NO_TMUX=1 bash $(printf '%q' "$0") $(printf '%q' "$PHASE"); ec=\$?; echo; echo Exit=\$ec; echo Log: $LOG_FILE; echo; echo Press Enter to close.; read _ || true; exit \$ec"
}

acquire_wakelock() {
  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock || true
    log "Wake-lock acquired"
  fi
}

guest_login() {
  proot-distro login "$DISTRO" \
    --bind "$PHOTOS_TERMUX:$PHOTOS_GUEST" \
    --bind "$REPO_ROOT:$APP_GUEST" \
    -- "$@"
}

# ---------------------------------------------------------------------------
# Phase: --inside-*  (runs inside Ubuntu)
# ---------------------------------------------------------------------------
if [ "$PHASE" = "--inside-apt" ]; then
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST"
  export DEBIAN_FRONTEND=noninteractive
  log "apt update + install (inside Ubuntu)"
  apt-get update -y
  apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential cmake pkg-config \
    ffmpeg libgl1 libglib2.0-0 git curl
  ok "apt packages installed"
  exit 0
fi

if [ "$PHASE" = "--inside-pip" ]; then
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST"
  export PIP_DISABLE_PIP_VERSION_CHECK=1
  export PIP_NO_CACHE_DIR=1
  # Keep pip memory lower
  export PYTHONUNBUFFERED=1

  log "Creating venv (if needed)"
  if [ ! -x .venv/bin/python ]; then
    python3 -m venv .venv
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install --upgrade pip wheel setuptools

  # Install in small batches so Android is less likely to OOM-kill Termux
  log "pip batch 1/4 — web + basics"
  pip install \
    "Pillow>=10.0.0" "pillow-heif>=0.16.0" "piexif>=1.1.3" \
    "tqdm>=4.66.0" "PyYAML>=6.0" "httpx>=0.27.0" "watchdog>=4.0.0" \
    "fastapi>=0.115.0" "uvicorn[standard]>=0.32.0" "websockets>=13.0" \
    "python-multipart>=0.0.12"

  log "pip batch 2/4 — numpy / sklearn / faiss / imagehash"
  pip install \
    "numpy>=1.26.0" "scikit-learn>=1.5.0" "faiss-cpu>=1.8.0" \
    "imagehash>=4.3.0" "hdbscan>=0.8.38"

  log "pip batch 3/4 — torch (LARGE — phone may feel slow; do not close)"
  pip install "torch>=2.2.0" "torchvision>=0.17.0"
  pip install "open-clip-torch>=2.26.0"

  log "pip batch 4/4 — onnx / faces / whisper / llama"
  pip install "onnxruntime>=1.19.0" "insightface>=0.7.3"
  pip install "faster-whisper>=1.0.0"
  # llama-cpp may need a long compile; prefer wheel if available
  pip install "llama-cpp-python>=0.3.0" || \
    log "WARNING: llama-cpp-python failed — chat LLM may be unavailable; continue"

  ok "pip packages installed"
  exit 0
fi

if [ "$PHASE" = "--inside-finish" ]; then
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST"
  # shellcheck disable=SC1091
  source .venv/bin/activate
  cp config.phone.yaml config.yaml
  log "Relocating photo paths to $PHOTOS_GUEST"
  python scripts/relocate_paths.py --photos-root "$PHOTOS_GUEST"
  log "Status check"
  python -m memory_engine status || true
  ok "finish complete"
  exit 0
fi

# ---------------------------------------------------------------------------
# Termux-side phases
# ---------------------------------------------------------------------------
require_termux() {
  [ -d "/data/data/com.termux" ] || die "Run this inside Termux on Android."
  [ -d "$ENGINE_DIR" ] || die "Missing $ENGINE_DIR"
  [ -f "$ENGINE_DIR/requirements.txt" ] || die "Incomplete memory-engine at $ENGINE_DIR"
  if [ ! -f "$ENGINE_DIR/data/memory.db" ]; then
    die "Missing $ENGINE_DIR/data/memory.db — extract the data tar first:
  cd ~/pocket-server/memory-engine
  tar -xf ~/storage/shared/Download/memory-engine-data.tar
  ls -lh data/memory.db"
  fi
}

phase_termux() {
  log "Repo: $REPO_ROOT"
  log "Installing Termux packages (proot-distro, rsync, tmux)"
  pkg update -y
  pkg install -y proot-distro rsync tmux
  if [ -d "$HOME/storage" ]; then
    ok "storage already linked"
  else
    log "Linking storage (tap Allow if prompted)"
    termux-setup-storage || true
  fi
  [ -d "$PHOTOS_TERMUX" ] || printf '\033[1;33mWARNING: %s missing\033[0m\n' "$PHOTOS_TERMUX"
  ok "termux phase done"
}

phase_ubuntu() {
  log "Installing Ubuntu guest (one-time, can take several minutes)"
  if proot-distro list 2>/dev/null | grep -qw "$DISTRO"; then
    ok "Ubuntu already installed"
  else
    proot-distro install "$DISTRO"
  fi
  ok "ubuntu phase done"
}

phase_apt() {
  log "Installing Ubuntu apt packages"
  guest_login bash "$APP_GUEST/scripts/setup-memory-engine.sh" --inside-apt
  ok "apt phase done"
}

phase_pip() {
  log "Installing Python packages inside Ubuntu (30–90+ min on phone)"
  log "Progress also logged to $LOG_FILE"
  guest_login bash "$APP_GUEST/scripts/setup-memory-engine.sh" --inside-pip
  ok "pip phase done"
}

phase_finish() {
  log "Config + path relocate + verify"
  guest_login bash "$APP_GUEST/scripts/setup-memory-engine.sh" --inside-finish
  cat <<'EOF'

============================================================
Memory Engine ready.

Register with PM2:
  bash ~/pocket-server/scripts/pm2-memory-engine.sh
  pm2 list
  pm2 save

Open http://127.0.0.1:8765
============================================================
EOF
}

run_all() {
  phase_termux
  phase_ubuntu
  phase_apt
  phase_pip
  phase_finish
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
case "$PHASE" in
  --inside-apt|--inside-pip|--inside-finish)
    # already handled above
    ;;
  *)
    require_termux
    ensure_tmux
    acquire_wakelock
    log "Phase=$PHASE  log=$LOG_FILE"
    case "$PHASE" in
      all)     run_all ;;
      termux)  phase_termux ;;
      ubuntu)  phase_ubuntu ;;
      apt)     phase_apt ;;
      pip)     phase_pip ;;
      finish)  phase_finish ;;
      *) die "Unknown phase: $PHASE (use all|termux|ubuntu|apt|pip|finish)" ;;
    esac
    ;;
esac
