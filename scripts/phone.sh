#!/usr/bin/env bash
# Phone Server — unified CLI
#
#   bash scripts/phone.sh setup|start|clean|verify|backup|ngrok|postgres-tailscale|memory …
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/common.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-setup.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-verify.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-backup.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-start.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-clean.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-ngrok.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-postgres.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/cmd-memory.sh"

CMD="${1:-help}"
shift || true

case "$CMD" in
  setup)              cmd_setup "$@" ;;
  start|boot)         cmd_start "$@" ;;
  clean|rebuild)      cmd_clean "$@" ;;
  verify|check)       cmd_verify "$@" ;;
  backup)             cmd_backup "$@" ;;
  ngrok)              cmd_ngrok "$@" ;;
  postgres-tailscale|postgres|pg-tailscale)
                      cmd_postgres_tailscale "$@" ;;
  memory|mem)         cmd_memory "$@" ;;
  help|-h|--help)     phone_usage ;;
  *)
    echo "Unknown command: $CMD" >&2
    echo ""
    phone_usage
    exit 1
    ;;
esac
