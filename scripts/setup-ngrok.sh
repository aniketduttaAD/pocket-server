#!/data/data/com.termux/files/usr/bin/bash
# Install ngrok on Termux and expose Postgres (5432) with a standalone public TCP URL.
#
# Termux cannot run the generic Linux ngrok binary directly (e_type: 2).
# This script tries: pkg ngrok → tur-repo → termux-chroot wrapper.
set -euo pipefail

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME_DIR="${HOME:-/data/data/com.termux/files/home}"
ENV_FILE="${ENV_FILE:-$HOME_DIR/dash/.env}"
NGROK_LINUX="${HOME_DIR}/ngrok-linux"
NGROK_WRAPPER="${HOME_DIR}/ngrok-termux"

echo "==> ngrok Postgres tunnel setup"

require_termux() {
  if [ ! -d "/data/data/com.termux" ]; then
    echo "ERROR: Run this on Android Termux."
    exit 1
  fi
}

ngrok_works() {
  local bin="$1"
  [ -x "$bin" ] || return 1
  if "$bin" version >/dev/null 2>&1; then
    return 0
  fi
  if command -v termux-chroot >/dev/null 2>&1; then
    termux-chroot "$bin" version >/dev/null 2>&1 && return 0
  fi
  return 1
}

download_ngrok_linux() {
  echo "Downloading ngrok (for termux-chroot)..."
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
  mv "$tmp/ngrok" "$NGROK_LINUX"
  chmod +x "$NGROK_LINUX"
  rm -rf "$tmp"
}

install_pkg_ngrok() {
  if ngrok_works "$(command -v ngrok 2>/dev/null || true)"; then
    return 0
  fi
  echo "Trying pkg install ngrok..."
  pkg install -y tur-repo 2>/dev/null || true
  if pkg install -y ngrok 2>/dev/null && command -v ngrok >/dev/null 2>&1; then
    ngrok_works "$(command -v ngrok)" && return 0
  fi
  return 1
}

install_chroot_ngrok() {
  echo "Setting up ngrok via termux-chroot (required on modern Termux)..."
  pkg install -y proot resolv-conf 2>/dev/null || pkg install -y proot

  if [ ! -x "$NGROK_LINUX" ]; then
    download_ngrok_linux
  fi

  if ! termux-chroot "$NGROK_LINUX" version >/dev/null 2>&1; then
    echo "ERROR: ngrok failed inside termux-chroot."
    echo "Try: pkg update && pkg install proot resolv-conf"
    echo "Then re-run this script."
    exit 1
  fi

  cat > "$NGROK_WRAPPER" << EOF
#!/data/data/com.termux/files/usr/bin/bash
# ngrok wrapper — runs inside termux-chroot (Termux-compatible)
export HOME="${HOME_DIR}"
exec termux-chroot "${NGROK_LINUX}" "\$@"
EOF
  chmod +x "$NGROK_WRAPPER"
  NGROK_BIN="$NGROK_WRAPPER"
}

install_ngrok() {
  NGROK_BIN=""

  if install_pkg_ngrok; then
    NGROK_BIN="$(command -v ngrok)"
    echo "Using pkg ngrok: $NGROK_BIN"
    return
  fi

  # Remove broken direct binary from older script versions
  if [ -f "${HOME_DIR}/ngrok" ] && ! ngrok_works "${HOME_DIR}/ngrok"; then
    echo "Removing incompatible ~/ngrok binary..."
    rm -f "${HOME_DIR}/ngrok"
  fi

  install_chroot_ngrok
  echo "Using chroot wrapper: $NGROK_BIN"
}

read_env_token() {
  if [ -f "$ENV_FILE" ] && grep -q '^NGROK_AUTHTOKEN=' "$ENV_FILE"; then
    grep '^NGROK_AUTHTOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'
    return
  fi
  echo ""
}

require_termux

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found"
  exit 1
fi

install_ngrok

TOKEN="$(read_env_token)"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "your_token_here" ]; then
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
if grep -q '^NGROK_BIN=' "$ENV_FILE"; then
  sed -i "s|^NGROK_BIN=.*|NGROK_BIN=${NGROK_BIN}|" "$ENV_FILE"
else
  echo "NGROK_BIN=${NGROK_BIN}" >> "$ENV_FILE"
fi

if pm2 describe ngrok-db >/dev/null 2>&1; then
  pm2 delete ngrok-db >/dev/null 2>&1 || true
fi

pm2 start "$NGROK_BIN" --name ngrok-db --interpreter bash -- tcp 5432 --log stdout
pm2 save

sleep 3

API="http://127.0.0.1:4040/api/tunnels"
echo ""
if curl -sf "$API" >/dev/null 2>&1; then
  echo "Active tunnel:"
  curl -sf "$API" | tr ',' '\n' | grep -E 'public_url|addr' || true
else
  echo "Tunnel starting — check: pm2 logs ngrok-db"
  echo "Tip: turn on mobile hotspot if ngrok stays 'Reconnecting'"
fi

echo ""
echo "Done."
echo "  pm2 restart dash --update-env"
echo "  Remote URLs in dashboard sync automatically from ngrok."
