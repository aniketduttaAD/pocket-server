#!/usr/bin/env bash
# Shared helpers for phone-server scripts
# shellcheck disable=SC2034

: "${SCRIPT_DIR:=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DASH_SRC="$REPO_ROOT/dashboard"
DASH_DIR="${DASH_DIR:-$HOME/dash}"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_HOME="${TERMUX_HOME:-/data/data/com.termux/files/home}"
ENGINE_DIR="${MEMORY_ENGINE_DIR:-$(dirname "$REPO_ROOT")/memory-engine}"

die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
ok()  { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn(){ printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }

require_termux() {
  if [ ! -d "/data/data/com.termux" ]; then
    die "This must run on Android Termux (not Mac/desktop)."
  fi
}

prompt() {
  local var="$1" label="$2" default="${3:-}" secret="${4:-false}" value=""
  if [ "$secret" = "true" ]; then
    if [ -n "$default" ]; then read -rsp "$label [$default]: " value; echo
    else read -rsp "$label: " value; echo; fi
  else
    read -rp "$label [$default]: " value
  fi
  value="${value:-$default}"
  printf -v "$var" '%s' "$value"
}

confirm() {
  local label="$1"
  read -rp "$label [y/N]: " ans
  [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]
}

step() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $*"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  else
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n'; echo
  fi
}

open_browser() {
  local url="$1"
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$url"
  else
    echo "Open this URL in your browser:"; echo "$url"
  fi
}

ensure_pm2_running() {
  local name="$1"
  shift
  local i
  pm2 delete "$name" 2>/dev/null || true
  pm2 start "$@"
  # Termux/Android can be slow — retry instead of a single 2s check.
  # Prefer pm2 list over `pm2 describe | grep status` (fragile across PM2 versions).
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    if pm2_online "$name"; then
      return 0
    fi
  done
  echo "PM2 logs for $name:"
  pm2 logs "$name" --lines 40 --nostream 2>/dev/null || true
  die "$name failed to start — see logs above"
}

pm2_online() {
  local name="$1"
  # Strip ANSI colors; match process name in the PM2 table row that is online
  pm2 list 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g' | grep -E "│[[:space:]]*[0-9]+[[:space:]]*│[[:space:]]*${name}[[:space:]]*│" | grep -qi online
}

expand_path() {
  local p="$1"
  p="${p/#\~/$HOME}"
  printf '%s' "$p"
}

default_media_root() {
  if [ -d "$HOME/storage/shared" ]; then echo "$HOME/storage/shared"
  elif [ -d "$HOME/storage/downloads" ]; then echo "$HOME/storage/downloads"
  else echo "$HOME/storage/shared"; fi
}

phone_usage() {
  cat <<EOF
Phone Server — unified control script

Usage:
  bash scripts/phone.sh <command> [args]

Commands:
  setup              Full Termux install (packages, media, tunnel, dashboard)
  start              After phone reboot — Postgres + PM2 resurrect
  clean              Wipe install (keeps ~/.cloudflared) then re-setup
  verify             Health checks
  backup             Backup dash / projects / postgres / cloudflared
  ngrok              Install ngrok + expose Postgres TCP
  postgres-tailscale Configure Postgres for Tailscale LAN
  memory <sub>       Memory Engine (setup|pm2|run|push|...)
  help               Show this help

Shortcuts:
  bash scripts/start.sh          → phone.sh start
  bash scripts/clean.sh          → phone.sh clean

Examples:
  bash scripts/phone.sh setup
  bash scripts/phone.sh start
  bash scripts/phone.sh clean
  bash scripts/phone.sh memory setup
  bash scripts/phone.sh memory run status
  bash scripts/phone.sh memory push --adb
EOF
}
