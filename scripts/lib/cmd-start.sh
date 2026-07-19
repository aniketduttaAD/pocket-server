# Start command — after phone reboot / Termux relaunch

cmd_start() {
  require_termux

  step "Starting Phone Server"
  echo "Repo: $REPO_ROOT"
  echo ""

  if command -v termux-wake-lock >/dev/null 2>&1; then
    termux-wake-lock || true
    ok "Wake-lock acquired"
  fi

  # Storage (no-op if already granted)
  if [ ! -d "$HOME/storage" ] && command -v termux-setup-storage >/dev/null 2>&1; then
    termux-setup-storage || true
  fi

  # PostgreSQL
  local pgdata="${PGDATA:-$HOME/postgres-data}"
  if [ -d "$pgdata" ]; then
    if pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
      ok "PostgreSQL already running"
    else
      log "Starting PostgreSQL…"
      pg_ctl -D "$pgdata" -l "$HOME/postgres.log" start || die "PostgreSQL failed — check ~/postgres.log"
      sleep 1
      psql -l >/dev/null 2>&1 || die "PostgreSQL started but not accepting connections"
      ok "PostgreSQL online"
    fi
  else
    warn "No ~/postgres-data — run: bash $SCRIPT_DIR/phone.sh setup"
  fi

  # PM2 processes
  if ! command -v pm2 >/dev/null 2>&1; then
    die "pm2 not found — run: bash $SCRIPT_DIR/phone.sh setup"
  fi

  if [ -f "$HOME/.pm2/dump.pm2" ]; then
    log "Resurrecting PM2 processes…"
    pm2 resurrect || true
  else
    warn "No PM2 dump — starting known services if present"
    if [ -f "$HOME/dash/src/index.js" ]; then
      pm2 describe dash >/dev/null 2>&1 || pm2 start "$HOME/dash/src/index.js" --name dash --cwd "$HOME/dash" || true
    fi
    if [ -f "$HOME/media-server/server.js" ]; then
      # shellcheck disable=SC1091
      if [ -f "$HOME/media-server/env.sh" ]; then set -a; source "$HOME/media-server/env.sh"; set +a; fi
      pm2 describe media >/dev/null 2>&1 || pm2 start "$HOME/media-server/server.js" --name media --interpreter node || true
    fi
    local cf_bin cf_config="$HOME/.cloudflared/config.yml"
    cf_bin="$(command -v cloudflared 2>/dev/null || true)"
    if [ -n "$cf_bin" ] && [ -f "$cf_config" ]; then
      local tunnel_name
      tunnel_name="$(grep -E '^tunnel:' "$cf_config" | awk '{print $2}')"
      pm2 describe tunnel >/dev/null 2>&1 || \
        pm2 start "$cf_bin" --name tunnel --interpreter none -- tunnel --config "$cf_config" run "${tunnel_name:-phone-tunnel}" || true
    fi
  fi

  sleep 2
  pm2 save 2>/dev/null || true

  echo ""
  echo "Service status:"
  pm2 list || true

  echo ""
  local failed=0
  for name in dash media tunnel; do
    if pm2_online "$name"; then
      ok "$name"
    else
      warn "$name not online"
      failed=1
    fi
  done

  if pm2 list 2>/dev/null | grep -qw memory; then
    if pm2_online memory; then ok "memory"
    else warn "memory not online — phone.sh memory pm2"; fi
  fi

  echo ""
  if [ "$failed" -eq 0 ]; then
    ok "Phone server is up"
  else
    warn "Some services failed — check: pm2 logs"
    echo "  Re-install: bash $SCRIPT_DIR/phone.sh setup"
    return 1
  fi
}
