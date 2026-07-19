# Postgres Tailscale — sourced by phone.sh

cmd_postgres_tailscale() {
  require_termux

  local PGDATA="${PGDATA:-$HOME/postgres-data}"
  local CONF="$PGDATA/postgresql.conf"
  local HBA="$PGDATA/pg_hba.conf"

  [ -d "$PGDATA" ] || die "PGDATA not found: $PGDATA"
  [ -f "$CONF" ] || die "postgresql.conf not found"

  echo "==> Configuring Postgres for Tailscale"

  if grep -qE '^[[:space:]]*#?[[:space:]]*listen_addresses' "$CONF"; then
    sed -i -E "s/^[[:space:]]*#?[[:space:]]*listen_addresses.*/listen_addresses = '*'/" "$CONF"
  else
    echo "listen_addresses = '*'" >> "$CONF"
  fi

  if ! grep -q '100\.64\.0\.0/10' "$HBA"; then
    echo "host    all    all    100.64.0.0/10    scram-sha-256" >> "$HBA"
  fi

  echo "Restarting Postgres…"
  pg_ctl -D "$PGDATA" restart
  sleep 1

  local LISTEN PORT
  LISTEN="$(psql -d postgres -Atqc "SHOW listen_addresses;" 2>/dev/null || true)"
  PORT="$(psql -d postgres -Atqc "SHOW port;" 2>/dev/null || true)"

  echo ""
  echo "listen_addresses = ${LISTEN:-unknown}"
  echo "port             = ${PORT:-unknown}"

  if [ "$LISTEN" != "*" ] && [ "$LISTEN" != "0.0.0.0" ]; then
    warn "listen_addresses is still '$LISTEN' — check $CONF"
    return 1
  fi

  echo ""
  echo "Done. Set your phone Tailscale IP in ~/dash/.env:"
  echo "  DB_PUBLIC_HOST=100.x.x.x"
  echo "  pm2 restart dash --update-env"
}
