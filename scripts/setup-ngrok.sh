#!/data/data/com.termux/files/usr/bin/bash
# Install ngrok on Termux and expose Postgres (5432) with a standalone public TCP URL.
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
NGROK_BIN="${NGROK_BIN:-$HOME_DIR/ngrok}"
ENV_FILE="${ENV_FILE:-$HOME_DIR/dash/.env}"

echo "==> ngrok Postgres tunnel setup"

install_ngrok() {
  if [ -x "$NGROK_BIN" ] && "$NGROK_BIN" version >/dev/null 2>&1; then
    echo "Using ngrok: $NGROK_BIN"
    return
  fi

  echo "Downloading ngrok for Android arm64..."
  arch="$(uname -m)"
  case "$arch" in
    aarch64|arm64) ngrok_arch="arm64" ;;
    armv7l|arm) ngrok_arch="arm" ;;
    x86_64|amd64) ngrok_arch="amd64" ;;
    *) echo "Unsupported arch: $arch"; exit 1 ;;
  esac

  tmp="$(mktemp -d)"
  curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${ngrok_arch}.tgz" -o "$tmp/ngrok.tgz"
  tar -xzf "$tmp/ngrok.tgz" -C "$tmp"
  mv "$tmp/ngrok" "$NGROK_BIN"
  chmod +x "$NGROK_BIN"
  rm -rf "$tmp"
  echo "Installed: $NGROK_BIN"
}

read_env_token() {
  if [ -f "$ENV_FILE" ] && grep -q '^NGROK_AUTHTOKEN=' "$ENV_FILE"; then
    grep '^NGROK_AUTHTOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'
    return
  fi
  echo ""
}

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

install_ngrok

TOKEN="$(read_env_token)"
if [ -z "$TOKEN" ]; then
  echo ""
  echo "Add your ngrok authtoken to $ENV_FILE:"
  echo "  NGROK_ENABLED=true"
  echo "  NGROK_AUTHTOKEN=your_token_here"
  echo ""
  echo "Get token: https://dashboard.ngrok.com/get-started/your-authtoken"
  echo "Note: ngrok TCP requires a free account + payment method on file."
  exit 1
fi

"$NGROK_BIN" config add-authtoken "$TOKEN"

grep -q '^NGROK_ENABLED=' "$ENV_FILE" || echo "NGROK_ENABLED=true" >> "$ENV_FILE"
grep -q '^NGROK_BIN=' "$ENV_FILE" || echo "NGROK_BIN=$NGROK_BIN" >> "$ENV_FILE"

if pm2 describe ngrok-db >/dev/null 2>&1; then
  pm2 delete ngrok-db >/dev/null 2>&1 || true
fi

pm2 start "$NGROK_BIN" --name ngrok-db --interpreter none -- tcp 5432 --log stdout
pm2 save

sleep 2

API="http://127.0.0.1:4040/api/tunnels"
if command -v curl >/dev/null 2>&1; then
  echo ""
  echo "Active tunnel:"
  curl -sf "$API" | tr ',' '\n' | grep -E 'public_url|addr' || echo "Tunnel starting — check: pm2 logs ngrok-db"
fi

echo ""
echo "Done."
echo "  pm2 restart dash --update-env"
echo "  Remote URLs in dashboard will use the ngrok TCP address."
echo ""
echo "Optional (paid ngrok — fixed host/port that survives restarts):"
echo "  NGROK_TCP_HOST=0.tcp.ngrok.io"
echo "  NGROK_TCP_PORT=12345"
