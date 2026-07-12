#!/data/data/com.termux/files/usr/bin/bash
# End-to-end verification — run on Android Termux after setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HOME/dash/.env}"
BASE="${BASE_URL:-http://127.0.0.1:3000}"
PASS=0
FAIL=0

if [ ! -d "/data/data/com.termux" ]; then
  echo "WARNING: Not running on Termux. Some checks may not apply."
fi

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "✓ $name"
    PASS=$((PASS + 1))
  else
    echo "✗ $name"
    FAIL=$((FAIL + 1))
  fi
}

echo "==> Phone Server Verification"
echo "Base URL: $BASE"
echo ""

check "Health endpoint" curl -sf "$BASE/api/health"
check "Login page" curl -sf "$BASE/login.html"
check "Security headers present" sh -c "curl -sI '$BASE/login.html' | grep -qi 'x-content-type-options'"

if [ -f "$ENV_FILE" ]; then
  export ADMIN_USER="$(grep '^ADMIN_USER=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
  export ADMIN_PASSWORD="$(grep '^ADMIN_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
  export BASE_URL="$BASE"
  if [ -n "$ADMIN_USER" ] && [ -n "$ADMIN_PASSWORD" ]; then
    check "Dashboard API smoke" node "$SCRIPT_DIR/../dashboard/scripts/smoke-test.js"
  else
    echo "○ Skipping API smoke (credentials not in .env)"
  fi

  if grep -q 'BIND_HOST=127.0.0.1' "$ENV_FILE"; then
    echo "✓ Dashboard configured for localhost-only bind"
    PASS=$((PASS + 1))
  else
    echo "✗ Dashboard must use BIND_HOST=127.0.0.1"
    FAIL=$((FAIL + 1))
  fi

  if grep -q 'NODE_ENV=production' "$ENV_FILE"; then
    echo "✓ Production mode configured"
    PASS=$((PASS + 1))
  else
    echo "✗ NODE_ENV must be production"
    FAIL=$((FAIL + 1))
  fi

  if grep -q 'ADMIN_PASSWORD=changeme' "$ENV_FILE"; then
    echo "✗ Default admin password still in use"
    FAIL=$((FAIL + 1))
  else
    echo "✓ Admin password changed from default"
    PASS=$((PASS + 1))
  fi
else
  echo "✗ Dashboard .env not found at $ENV_FILE"
  FAIL=$((FAIL + 1))
fi

if command -v pm2 >/dev/null 2>&1; then
  check "PM2 available" pm2 -v
  check "Dashboard PM2 process" pm2 describe dash
  check "Media PM2 process" pm2 describe media
fi

if command -v psql >/dev/null 2>&1; then
  check "PostgreSQL reachable" psql -l
fi

if [ -x "$HOME/cloudflared" ]; then
  check "cloudflared binary" "$HOME/cloudflared" -v
fi

if pm2 describe tunnel 2>/dev/null | grep -qE 'status.*online'; then
  echo "✓ Cloudflare tunnel running (PM2)"
  PASS=$((PASS + 1))
elif pgrep -f cloudflared >/dev/null 2>&1; then
  echo "✓ Cloudflare tunnel running"
  PASS=$((PASS + 1))
else
  echo "✗ Cloudflare tunnel not running"
  FAIL=$((FAIL + 1))
fi

if [ -f "$HOME/filebrowser/config.json" ]; then
  if grep -q '"address".*"127.0.0.1"' "$HOME/filebrowser/config.json"; then
    echo "✓ File Browser bound to localhost"
    PASS=$((PASS + 1))
  else
    echo "✗ File Browser must bind to 127.0.0.1"
    FAIL=$((FAIL + 1))
  fi
fi

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [ "$FAIL" -gt 0 ]; then
  echo "Some checks failed — see README.md"
  exit 1
fi

echo ""
echo "Manual checks (required before going live):"
echo "  [ ] https://dash.<domain> loads via Cloudflare Access"
echo "  [ ] https://media.<domain> loads via Cloudflare Access"
echo "  [ ] http://<phone-lan-ip>:3000 is NOT reachable from another device"
echo "  [ ] Upload a test project and create a test database"
