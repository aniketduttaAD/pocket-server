#!/data/data/com.termux/files/usr/bin/bash
# Allow Postgres connections over Tailscale (100.x.x.x tailnet).
set -euo pipefail

PGDATA="${PGDATA:-$HOME/postgres-data}"
CONF="$PGDATA/postgresql.conf"
HBA="$PGDATA/pg_hba.conf"

[ -d "$PGDATA" ] || { echo "ERROR: PGDATA not found: $PGDATA"; exit 1; }

echo "==> Configuring Postgres for Tailscale"

# listen on all interfaces (still protected by pg_hba + not on public LAN if phone firewall ok)
if grep -q "^listen_addresses" "$CONF"; then
  sed -i "s/^listen_addresses.*/listen_addresses = '*'/" "$CONF"
else
  echo "listen_addresses = '*'" >> "$CONF"
fi

# tailnet CGNAT range
if ! grep -q '100\.64\.0\.0/10' "$HBA"; then
  echo "host    all    all    100.64.0.0/10    scram-sha-256" >> "$HBA"
fi

pg_ctl -D "$PGDATA" reload 2>/dev/null || pg_ctl -D "$PGDATA" restart

echo "Done. Get phone Tailscale IP from the Tailscale app, then set in ~/dash/.env:"
echo "  DB_PUBLIC_HOST=100.x.x.x"
echo "  pm2 restart dash"
