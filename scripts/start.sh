#!/usr/bin/env bash
# After phone reboot / Termux relaunch — start Postgres + resurrect PM2 services.
# Prefer adding this to Termux:Boot or run manually:
#   bash ~/phone-server/scripts/start.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/phone.sh" start "$@"
