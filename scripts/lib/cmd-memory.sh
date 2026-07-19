# Memory Engine — setup / pm2 / run / push
# Sourced by phone.sh

DISTRO="${DISTRO:-ubuntu}"
PHOTOS_TERMUX="${PHOTOS_TERMUX:-$HOME/storage/dcim}"
PHOTOS_GUEST="/root/photos"
APP_GUEST="/root/app"
ENGINE_GUEST="/root/memory-engine"
MEMORY_LOG_DIR="$HOME/logs"
MEMORY_LOG_FILE="$MEMORY_LOG_DIR/memory-engine-setup.log"

memory_guest_login() {
  proot-distro login "$DISTRO" \
    --bind "$PHOTOS_TERMUX:$PHOTOS_GUEST" \
    --bind "$REPO_ROOT:$APP_GUEST" \
    --bind "$ENGINE_DIR:$ENGINE_GUEST" \
    -- "$@"
}

cmd_memory_inside_apt() {
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST"
  export DEBIAN_FRONTEND=noninteractive
  log "apt update + install (inside Ubuntu)"
  apt-get update -y
  apt-get install -y \
    python3 python3-pip python3-venv \
    build-essential cmake pkg-config \
    ffmpeg libgl1 libglib2.0-0 git curl
  ok "apt packages installed"
}

cmd_memory_inside_pip() {
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST"
  export PIP_DISABLE_PIP_VERSION_CHECK=1
  export PIP_NO_CACHE_DIR=1
  export PYTHONUNBUFFERED=1

  log "Creating venv (if needed)"
  if [ ! -x .venv/bin/python ]; then
    python3 -m venv .venv
  fi
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install --upgrade pip wheel setuptools

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

  log "pip batch 3/4 — torch (LARGE)"
  pip install "torch>=2.2.0" "torchvision>=0.17.0"
  pip install "open-clip-torch>=2.26.0"

  log "pip batch 4/4 — onnx / faces / whisper / llama"
  pip install "onnxruntime>=1.19.0" "insightface>=0.7.3"
  pip install "faster-whisper>=1.0.0"
  pip install "llama-cpp-python>=0.3.0" || log "WARNING: llama-cpp-python failed — continue"

  ok "pip packages installed"
}

cmd_memory_inside_finish() {
  cd "$ENGINE_GUEST" || die "Engine not found at $ENGINE_GUEST"
  # shellcheck disable=SC1091
  source .venv/bin/activate
  cp config.phone.yaml config.yaml
  log "Relocating photo paths to $PHOTOS_GUEST"
  python scripts/relocate_paths.py --photos-root "$PHOTOS_GUEST"
  log "Status check"
  python -m memory_engine status || true
  ok "finish complete"
}

memory_ensure_tmux() {
  local phase="$1"
  if [ -n "${TMUX:-}" ] || [ "${MEMORY_ENGINE_NO_TMUX:-}" = "1" ]; then
    return 0
  fi
  if ! command -v tmux >/dev/null 2>&1; then
    pkg install -y tmux || true
  fi
  if ! command -v tmux >/dev/null 2>&1; then
    warn "tmux not available — continuing without it"
    return 0
  fi
  log "Re-launching inside tmux session 'memory-setup'"
  echo "  Detach: Ctrl+b then d"
  echo "  Re-attach: tmux attach -t memory-setup"
  echo "  Log: $MEMORY_LOG_FILE"
  sleep 2
  exec tmux new-session -A -s memory-setup \
    "MEMORY_ENGINE_NO_TMUX=1 bash $(printf '%q' "$SCRIPT_DIR/phone.sh") memory setup $(printf '%q' "$phase"); ec=\$?; echo; echo Exit=\$ec; echo Log: $MEMORY_LOG_FILE; echo; echo Press Enter to close.; read _ || true; exit \$ec"
}

memory_require() {
  require_termux
  [ -d "$ENGINE_DIR" ] || die "Missing $ENGINE_DIR — clone memory-engine next to this repo"
  [ -f "$ENGINE_DIR/requirements.txt" ] || die "Incomplete memory-engine at $ENGINE_DIR"
  if [ ! -f "$ENGINE_DIR/data/memory.db" ]; then
    die "Missing $ENGINE_DIR/data/memory.db — extract data first:
  mkdir -p $ENGINE_DIR && cd $ENGINE_DIR
  tar -xf ~/storage/shared/Download/memory-engine-data.tar
  ls -lh data/memory.db"
  fi
}

memory_phase_termux() {
  mkdir -p "$MEMORY_LOG_DIR"
  touch "$MEMORY_LOG_FILE"
  log "Installing Termux packages (proot-distro, rsync, tmux)"
  pkg update -y
  pkg install -y proot-distro rsync tmux
  if [ -d "$HOME/storage" ]; then ok "storage already linked"
  else
    log "Linking storage…"
    termux-setup-storage || true
  fi
  [ -d "$PHOTOS_TERMUX" ] || warn "$PHOTOS_TERMUX missing"
  ok "termux phase done"
}

memory_ubuntu_installed() {
  proot-distro login "$DISTRO" -- bash -c 'exit 0' >/dev/null 2>&1
}

memory_phase_ubuntu() {
  log "Installing Ubuntu guest"
  if memory_ubuntu_installed; then ok "Ubuntu already installed"; return 0; fi
  if proot-distro install "$DISTRO"; then ok "ubuntu phase done"; return 0; fi
  if memory_ubuntu_installed; then ok "Ubuntu already installed"; return 0; fi
  die "Ubuntu install failed"
}

memory_phase_apt() {
  log "Installing Ubuntu apt packages"
  memory_guest_login bash "$APP_GUEST/scripts/phone.sh" memory --inside-apt
  ok "apt phase done"
}

memory_phase_pip() {
  log "Installing Python packages (30–90+ min on phone)"
  memory_guest_login bash "$APP_GUEST/scripts/phone.sh" memory --inside-pip
  ok "pip phase done"
}

memory_phase_finish() {
  log "Config + path relocate + verify"
  memory_guest_login bash "$APP_GUEST/scripts/phone.sh" memory --inside-finish
  cat <<EOF

============================================================
Memory Engine ready.

Register with PM2:
  bash $SCRIPT_DIR/phone.sh memory pm2
  pm2 list

Open http://127.0.0.1:8765
============================================================
EOF
}

memory_phase_resume() {
  log "Auto-resume: detecting progress"
  if ! command -v proot-distro >/dev/null 2>&1; then memory_phase_termux; fi
  memory_phase_ubuntu
  if ! memory_guest_login bash -lc 'python3 -m venv -h >/dev/null 2>&1'; then
    memory_phase_apt
  else ok "apt/python3-venv present — skip"; fi
  if ! memory_guest_login bash -lc "cd $ENGINE_GUEST && test -f .venv/bin/activate && . .venv/bin/activate && python -c 'import uvicorn, fastapi, yaml'"; then
    memory_phase_pip
  else ok "core pip packages present — skip"; fi
  memory_phase_finish
}

cmd_memory_setup() {
  local phase="${1:-all}"
  case "$phase" in
    --inside-apt)    cmd_memory_inside_apt; return ;;
    --inside-pip)    cmd_memory_inside_pip; return ;;
    --inside-finish) cmd_memory_inside_finish; return ;;
  esac

  memory_require
  memory_ensure_tmux "$phase"
  if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock || true; fi
  mkdir -p "$MEMORY_LOG_DIR"; touch "$MEMORY_LOG_FILE"
  log "Phase=$phase  log=$MEMORY_LOG_FILE"

  case "$phase" in
    all)
      memory_phase_termux
      memory_phase_ubuntu
      memory_phase_apt
      memory_phase_pip
      memory_phase_finish
      ;;
    resume) memory_phase_resume ;;
    termux) memory_phase_termux ;;
    ubuntu) memory_phase_ubuntu ;;
    apt)    memory_phase_apt ;;
    pip)    memory_phase_pip ;;
    finish) memory_phase_finish ;;
    *) die "Unknown memory setup phase: $phase (all|resume|termux|ubuntu|apt|pip|finish)" ;;
  esac
}

cmd_memory_pm2() {
  require_termux
  command -v pm2 >/dev/null 2>&1 || die "pm2 not found — npm install -g pm2"
  command -v proot-distro >/dev/null 2>&1 || die "proot-distro missing — phone.sh memory setup first"

  if [ ! -f "$ENGINE_DIR/.venv/pyvenv.cfg" ] && [ ! -f "$ENGINE_DIR/.venv/bin/activate" ]; then
    die "Python venv missing. Run: bash $SCRIPT_DIR/phone.sh memory setup"
  fi

  pm2 delete memory 2>/dev/null || true
  pm2 start "$SCRIPT_DIR/phone.sh" \
    --name memory \
    --interpreter bash \
    -- memory run serve
  pm2 save

  echo ""
  ok "Memory Engine registered as PM2 'memory'"
  echo "  pm2 logs memory --lines 50"
  echo "  Open http://127.0.0.1:8765"
}

cmd_memory_run() {
  local CMD="${1:-serve}"
  shift || true
  local EXTRA=""
  for a in "$@"; do
    EXTRA="$EXTRA $(printf '%q' "$a")"
  done

  exec proot-distro login "$DISTRO" \
    --bind "$PHOTOS_TERMUX:$PHOTOS_GUEST" \
    --bind "$ENGINE_DIR:$ENGINE_GUEST" \
    -- bash -lc "cd $(printf '%q' "$ENGINE_GUEST") && source .venv/bin/activate && exec python -m memory_engine $(printf '%q' "$CMD")$EXTRA"
}

cmd_memory_push() {
  # Runs on Mac (dev machine), not Termux
  local DATA_SRC="$ENGINE_DIR/data"
  local TAR
  TAR="$(dirname "$REPO_ROOT")/memory-engine-data.tar"
  local ADB="${ADB:-adb}"
  command -v adb >/dev/null 2>&1 || ADB="/Users/aniketdutta/Library/Android/sdk/platform-tools/adb"

  [ -f "$DATA_SRC/memory.db" ] || die "Missing $DATA_SRC/memory.db"

  if [ "${1:-}" = "--adb" ]; then
    [ -x "$ADB" ] || command -v "$ADB" >/dev/null 2>&1 || die "adb not found"
    "$ADB" get-state >/dev/null 2>&1 || die "No device — plug in USB and enable debugging"

    echo "Creating archive…"
    rm -f "$TAR"
    tar -cf "$TAR" -C "$(dirname "$DATA_SRC")" data
    ls -lh "$TAR"

    echo "Pushing to /sdcard/Download/memory-engine-data.tar …"
    "$ADB" push "$TAR" /sdcard/Download/memory-engine-data.tar

    cat <<EOF

On the phone (Termux):

  mkdir -p ~/memory-engine && cd ~/memory-engine
  tar -xf ~/storage/shared/Download/memory-engine-data.tar
  ls -lh data/memory.db

  bash ~/phone-server/scripts/phone.sh memory setup
  bash ~/phone-server/scripts/phone.sh memory pm2
  pm2 list
EOF
    return 0
  fi

  local TARGET="${1:-}"
  [ -n "$TARGET" ] || die "Usage: phone.sh memory push --adb   OR   phone.sh memory push user@PHONE_IP"

  echo "Syncing $DATA_SRC  ->  $TARGET:~/memory-engine/data"
  ssh "$TARGET" "mkdir -p ~/memory-engine/data"
  rsync -avz --progress --partial "$DATA_SRC/" "$TARGET:~/memory-engine/data/"
  echo "Done. On phone: bash ~/phone-server/scripts/phone.sh memory setup"
}

cmd_memory() {
  local sub="${1:-}"
  shift || true
  case "$sub" in
    ""|help|-h|--help)
      cat <<EOF
Memory Engine commands:
  phone.sh memory setup [all|resume|termux|ubuntu|apt|pip|finish]
  phone.sh memory pm2
  phone.sh memory run [serve|ingest|status|search …]
  phone.sh memory push --adb | user@PHONE_IP
EOF
      ;;
    setup) cmd_memory_setup "$@" ;;
    pm2|start) cmd_memory_pm2 "$@" ;;
    run) cmd_memory_run "$@" ;;
    push) cmd_memory_push "$@" ;;
    --inside-apt|--inside-pip|--inside-finish)
      cmd_memory_setup "$sub" "$@"
      ;;
    *)
      # Convenience: phone.sh memory status → memory run status
      cmd_memory_run "$sub" "$@"
      ;;
  esac
}
