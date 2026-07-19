# Clean + rebuild — wipes Termux install but keeps Cloudflare tunnel config

cmd_clean() {
  require_termux

  step "Clean rebuild"
  echo "This will REMOVE:"
  echo "  • ~/dash, ~/media-server, ~/postgres-data"
  echo "  • ~/projects, ~/uploads, ~/logs, PM2 processes"
  echo "  • ngrok binaries/wrappers"
  echo "  • Memory Engine Python venv (engine data kept if present)"
  echo ""
  echo "This will KEEP:"
  echo "  • ~/.cloudflared/  (login cert, tunnel credentials, config.yml)"
  echo "  • This git repo ($REPO_ROOT)"
  echo "  • Phone media files under storage/"
  echo ""

  if ! confirm "Wipe and rebuild everything except Cloudflare config?"; then
    echo "Aborted."
    return 0
  fi

  # Optional backup first
  if confirm "Create a backup first?"; then
    cmd_backup || true
  fi

  log "Stopping services…"
  if command -v pm2 >/dev/null 2>&1; then
    pm2 kill 2>/dev/null || true
  fi

  local pgdata="${PGDATA:-$HOME/postgres-data}"
  if [ -d "$pgdata" ] && command -v pg_ctl >/dev/null 2>&1; then
    pg_ctl -D "$pgdata" stop -m fast 2>/dev/null || true
  fi

  log "Preserving Cloudflare config…"
  local cf_backup=""
  if [ -d "$HOME/.cloudflared" ]; then
    cf_backup="$(mktemp -d)/cloudflared-keep"
    cp -a "$HOME/.cloudflared" "$cf_backup"
    ok "Cloudflare config stashed"
  else
    warn "No ~/.cloudflared found — tunnel will need login during setup"
  fi

  log "Removing install artifacts…"
  rm -rf \
    "$HOME/dash" \
    "$HOME/media-server" \
    "$HOME/postgres-data" \
    "$HOME/postgres.log" \
    "$HOME/projects" \
    "$HOME/uploads" \
    "$HOME/logs" \
    "$HOME/.pm2" \
    "$HOME/ngrok" \
    "$HOME/ngrok-linux" \
    "$HOME/ngrok-termux" \
    "$HOME/cloudflared"

  # Memory engine venv only (keep indexed data)
  if [ -d "$ENGINE_DIR/.venv" ]; then
    rm -rf "$ENGINE_DIR/.venv"
    ok "Removed Memory Engine venv"
  fi

  # Restore cloudflared
  if [ -n "$cf_backup" ] && [ -d "$cf_backup" ]; then
    rm -rf "$HOME/.cloudflared"
    mkdir -p "$HOME"
    mv "$cf_backup" "$HOME/.cloudflared"
    ok "Restored ~/.cloudflared"
  fi

  # Refresh media + dashboard source from repo into place happens in setup
  log "Syncing media server source from repo…"
  # setup phase_media will rsync again

  echo ""
  ok "Clean complete. Starting fresh setup…"
  echo "Cloudflare tunnel config was preserved — setup will reuse it."
  echo ""

  # Force full setup (skip "update only" path by ensuring dash is gone)
  cmd_setup
}
