# ngrok Postgres tunnel — sourced by phone.sh

cmd_ngrok() {
  require_termux

  local ENV_FILE="${ENV_FILE:-$HOME/dash/.env}"
  local NGROK_LINUX="${HOME}/ngrok-linux"
  local NGROK_WRAPPER="${HOME}/ngrok-termux"
  local NGROK_BIN=""

  echo "==> ngrok Postgres tunnel setup"

  [ -f "$ENV_FILE" ] || die "$ENV_FILE not found — run phone.sh setup first"

  ngrok_works() {
    local bin="$1"
    [ -x "$bin" ] || return 1
    if "$bin" version >/dev/null 2>&1; then return 0; fi
    if command -v termux-chroot >/dev/null 2>&1; then
      termux-chroot "$bin" version >/dev/null 2>&1 && return 0
    fi
    return 1
  }

  download_ngrok_linux() {
    echo "Downloading ngrok (for termux-chroot)…"
    local arch ngrok_arch tmp
    arch="$(uname -m)"
    case "$arch" in
      aarch64|arm64) ngrok_arch="arm64" ;;
      armv7l|arm) ngrok_arch="arm" ;;
      x86_64|amd64) ngrok_arch="amd64" ;;
      *) die "Unsupported arch: $arch" ;;
    esac
    tmp="$(mktemp -d)"
    curl -fsSL "https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-${ngrok_arch}.tgz" -o "$tmp/ngrok.tgz"
    tar -xzf "$tmp/ngrok.tgz" -C "$tmp"
    mv "$tmp/ngrok" "$NGROK_LINUX"
    chmod +x "$NGROK_LINUX"
    rm -rf "$tmp"
  }

  install_pkg_ngrok() {
    if ngrok_works "$(command -v ngrok 2>/dev/null || true)"; then return 0; fi
    echo "Trying pkg install ngrok…"
    pkg install -y tur-repo 2>/dev/null || true
    if pkg install -y ngrok 2>/dev/null && command -v ngrok >/dev/null 2>&1; then
      ngrok_works "$(command -v ngrok)" && return 0
    fi
    return 1
  }

  install_chroot_ngrok() {
    echo "Setting up ngrok via termux-chroot…"
    pkg install -y proot resolv-conf 2>/dev/null || pkg install -y proot
    [ -x "$NGROK_LINUX" ] || download_ngrok_linux
    if ! termux-chroot "$NGROK_LINUX" version >/dev/null 2>&1; then
      die "ngrok failed inside termux-chroot — try: pkg update && pkg install proot resolv-conf"
    fi
    cat > "$NGROK_WRAPPER" << EOF
#!/data/data/com.termux/files/usr/bin/bash
export HOME="${HOME}"
exec termux-chroot "${NGROK_LINUX}" "\$@"
EOF
    chmod +x "$NGROK_WRAPPER"
    NGROK_BIN="$NGROK_WRAPPER"
  }

  if install_pkg_ngrok; then
    NGROK_BIN="$(command -v ngrok)"
    echo "Using pkg ngrok: $NGROK_BIN"
  else
    if [ -f "${HOME}/ngrok" ] && ! ngrok_works "${HOME}/ngrok"; then
      echo "Removing incompatible ~/ngrok binary…"
      rm -f "${HOME}/ngrok"
    fi
    install_chroot_ngrok
    echo "Using chroot wrapper: $NGROK_BIN"
  fi

  local TOKEN
  TOKEN="$(grep '^NGROK_AUTHTOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '"' || true)"
  if [ -z "$TOKEN" ] || [ "$TOKEN" = "your_token_here" ]; then
    echo ""
    echo "Add your ngrok authtoken to $ENV_FILE:"
    echo "  NGROK_ENABLED=true"
    echo "  NGROK_AUTHTOKEN=your_token_here"
    echo ""
    echo "Get token: https://dashboard.ngrok.com/get-started/your-authtoken"
    return 1
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

  local API="http://127.0.0.1:4040/api/tunnels"
  echo ""
  if curl -sf "$API" >/dev/null 2>&1; then
    echo "Active tunnel:"
    curl -sf "$API" | tr ',' '\n' | grep -E 'public_url|addr' || true
  else
    echo "Tunnel starting — check: pm2 logs ngrok-db"
  fi

  echo ""
  echo "Done.  pm2 restart dash --update-env"
}
