#!/usr/bin/env bash
# Wipe phone-server install and rebuild from scratch.
# Keeps ~/.cloudflared (tunnel login + config). Removes dash, media, postgres, PM2, etc.
#
#   bash ~/phone-server/scripts/clean.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$SCRIPT_DIR/phone.sh" clean "$@"
