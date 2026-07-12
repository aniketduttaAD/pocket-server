#!/data/data/com.termux/files/usr/bin/bash
# Allow Postgres connections over Tailscale (100.x.x.x tailnet).
set -euo pipefail

PGDATA="${PGDATA:-$HOME/postgres-data}"
CONF="$PGDATA/postgresql.conf"
HBA="$PGDATA/pg_hba.conf"

[ -d "$PGDATA" ] || { echo "ERROR: PGDATA not found: $PGDATA"; exit 1; }
[ -f "$CONF" ] || { echo "ERROR: postgresql.conf not found"; exit 1; }

echo "==> Configuring Postgres for Tailscale"

# listen_addresses requires a full restart (reload is not enough)
if grep -qE '^[[:space:]]*#?[[:space:]]*listen_addresses' "$CONF"; then
  sed -i -E "s/^[[:space:]]*#?[[:space:]]*listen_addresses.*/listen_addresses = '*'/" "$CONF"
else
  echo "listen_addresses = '*'" >> "$CONF"
fi

# tailnet CGNAT range
if ! grep -q '100\.64\.0\.0/10' "$HBA"; then
  echo "host    all    all    100.64.0.0/10    scram-sha-256" >> "$HBA"
fi

echo "Restarting Postgres (required for listen_addresses)..."
pg_ctl -D "$PGDATA" restart

sleep 1

LISTEN="$(psql -d postgres -Atqc "SHOW listen_addresses;" 2>/dev/null || true)"
PORT="$(psql -d postgres -Atqc "SHOW port;" 2>/dev/null || true)"

echo ""
echo "listen_addresses = ${LISTEN:-unknown}"
echo "port             = ${PORT:-unknown}"

if [ "$LISTEN" != "*" ] && [ "$LISTEN" != "0.0.0.0" ]; then
  echo ""
  echo "WARNING: listen_addresses is still '$LISTEN' — check $CONF"
  exit 1
fi

echo ""
echo "Done. Set your phone Tailscale IP in ~/dash/.env:"
echo "  DB_PUBLIC_HOST=100.x.x.x"
echo "  pm2 restart dash --update-env"
