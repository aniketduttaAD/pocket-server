#!/data/data/com.termux/files/usr/bin/bash
# Phone Server — interactive setup for Android Termux ONLY
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DASH_SRC="$REPO_ROOT/dashboard"
DASH_DIR="$HOME/dash"
PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
TERMUX_HOME="/data/data/com.termux/files/home"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

die() { echo "ERROR: $*" >&2; exit 1; }

require_termux() {
  if [ ! -d "/data/data/com.termux" ]; then
    die "This script must run on Android Termux. It cannot run on Mac or Linux desktop."
  fi
}

prompt() {
  local var="$1"
  local label="$2"
  local default="${3:-}"
  local secret="${4:-false}"
  local value=""
  if [ "$secret" = "true" ]; then
    if [ -n "$default" ]; then
      read -rsp "$label [$default]: " value
      echo
    else
      read -rsp "$label: " value
      echo
    fi
  else
    read -rp "$label [$default]: " value
  fi
  value="${value:-$default}"
  printf -v "$var" '%s' "$value"
}

confirm() {
  local label="$1"
  read -rp "$label [y/N]: " ans
  [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]
}

step() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  $*"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  elif command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  else
    od -An -tx1 -N32 /dev/urandom | tr -d ' \n'
    echo
  fi
}

# ---------------------------------------------------------------------------
# Setup phases
# ---------------------------------------------------------------------------

phase_welcome() {
  step "Phone Server Setup"
  echo "This wizard installs everything on your Android phone (Termux)."
  echo "Repo: $REPO_ROOT"
  echo ""
  echo "Before continuing:"
  echo "  • Install Termux from F-Droid (not Play Store)"
  echo "  • Disable battery optimization for Termux"
  echo "  • Add your domain to Cloudflare (nameservers active)"
  echo ""
  if ! confirm "Continue?"; then
    echo "Aborted."
    exit 0
  fi
}

phase_config() {
  step "Configuration"
  prompt BASE_DOMAIN "Base domain" "aniketdutta.space"
  prompt TUNNEL_NAME "Cloudflare tunnel name" "phone-tunnel"
  prompt ADMIN_USER "Dashboard admin username" "admin"

  while true; do
    prompt ADMIN_PASSWORD "Dashboard admin password (min 8 chars)" "" true
    if [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
      echo "Password must be at least 8 characters."
      continue
    fi
    if [ "$ADMIN_PASSWORD" = "changeme" ]; then
      echo "Do not use the default password 'changeme'."
      continue
    fi
    break
  done

  prompt FB_USER "File Browser username" "aniket"
  while true; do
    prompt FB_PASSWORD "File Browser password (min 8 chars)" "" true
    if [ "${#FB_PASSWORD}" -lt 8 ]; then
      echo "Password must be at least 8 characters."
      continue
    fi
    break
  done

  prompt MEDIA_ROOT "Media files root on phone" "/storage/emulated/0/ServerFiles"
  SESSION_SECRET="$(gen_secret)"
  echo "Generated SESSION_SECRET."
}

phase_packages() {
  step "Installing system packages"
  pkg update -y && pkg upgrade -y
  pkg install -y git nodejs-lts python postgresql openssh curl wget tmux go unzip termux-services openssl

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "Installing PM2..."
    npm install -g pm2
  fi
}

phase_storage() {
  step "Storage access"
  echo "Granting storage permission (tap Allow if Android prompts)..."
  termux-setup-storage || true
  mkdir -p "$HOME/projects/frontend" "$HOME/projects/backend" "$HOME/uploads"
  mkdir -p "$HOME/filebrowser" "$HOME/logs" "$HOME/.cloudflared" "$HOME/backups"
  mkdir -p "$MEDIA_ROOT"
}

phase_postgres() {
  step "PostgreSQL"
  local pgdata="$HOME/postgres-data"
  if [ ! -d "$pgdata" ]; then
    echo "Initializing PostgreSQL at $pgdata..."
    mkdir -p "$pgdata"
    initdb -D "$pgdata"
  fi

  pg_ctl -D "$pgdata" -l "$HOME/postgres.log" start 2>/dev/null || true

  mkdir -p "$PREFIX/var/service/postgresql"
  cat > "$PREFIX/var/service/postgresql/run" << EOF
#!/data/data/com.termux/files/usr/bin/sh
exec pg_ctl -D "$pgdata" -l "$HOME/postgres.log" start -W
EOF
  chmod +x "$PREFIX/var/service/postgresql/run"
  sv-enable postgresql 2>/dev/null || true
  sv start postgresql 2>/dev/null || true

  psql -l >/dev/null 2>&1 || die "PostgreSQL failed to start. Check ~/postgres.log"
  echo "PostgreSQL is running."
}

phase_filebrowser() {
  step "File Browser (media.aniketdutta.space)"
  local fb_dir="$HOME/filebrowser"

  if ! command -v filebrowser >/dev/null 2>&1; then
    echo "Building File Browser (may take a few minutes)..."
    go install github.com/filebrowser/filebrowser/v2@latest
    export PATH="$PATH:$HOME/go/bin"
  fi

  cat > "$fb_dir/config.json" << EOF
{
  "port": 8080,
  "baseURL": "",
  "address": "127.0.0.1",
  "log": "stdout",
  "database": "$fb_dir/filebrowser.db",
  "root": "$MEDIA_ROOT"
}
EOF

  filebrowser -c "$fb_dir/config.json" config init 2>/dev/null || true
  filebrowser -c "$fb_dir/config.json" users add "$FB_USER" "$FB_PASSWORD" --perm.admin 2>/dev/null || \
    filebrowser -c "$fb_dir/config.json" users update "$FB_USER" --password "$FB_PASSWORD" --perm.admin 2>/dev/null || true

  pm2 delete media 2>/dev/null || true
  pm2 start filebrowser --name media -- -c "$fb_dir/config.json"
  pm2 save
  echo "File Browser running on 127.0.0.1:8080 (PM2: media)"
}

phase_cloudflared() {
  step "Cloudflare Tunnel"
  local cf_bin="$HOME/cloudflared"
  local cf_config="$HOME/.cloudflared/config.yml"

  if [ ! -x "$cf_bin" ]; then
    local arch cf_arch
    arch="$(uname -m)"
    case "$arch" in
      aarch64|arm64) cf_arch=arm64 ;;
      armv7l|arm) cf_arch=arm ;;
      *) die "Unsupported CPU architecture: $arch" ;;
    esac
    echo "Downloading cloudflared ($cf_arch)..."
    curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}" -o "$cf_bin"
    chmod +x "$cf_bin"
  fi

  if [ -f "$cf_config" ] && grep -q "^tunnel:" "$cf_config" 2>/dev/null; then
    echo "Existing tunnel config found at $cf_config"
    TUNNEL_ID="$(basename "$(grep credentials-file "$cf_config" | awk '{print $2}')" .json)"
    echo "Using tunnel ID: $TUNNEL_ID"
    return
  fi

  echo ""
  echo "Cloudflare tunnel setup (one-time):"
  echo "  1. Run: $cf_bin tunnel login"
  echo "     (Authorize in browser — select $BASE_DOMAIN)"
  echo "  2. Run: $cf_bin tunnel create $TUNNEL_NAME"
  echo "     (Save the Tunnel UUID printed)"
  echo ""
  if ! confirm "Have you completed tunnel login and create?"; then
    echo ""
    echo "Run the commands above, then re-run: bash $SCRIPT_DIR/setup.sh"
    exit 1
  fi

  prompt TUNNEL_ID "Enter tunnel UUID"

  if [ ! -f "$HOME/.cloudflared/${TUNNEL_ID}.json" ]; then
    die "Credentials file not found: ~/.cloudflared/${TUNNEL_ID}.json — run tunnel create first"
  fi

  cat > "$cf_config" << EOF
tunnel: $TUNNEL_NAME
credentials-file: $HOME/.cloudflared/${TUNNEL_ID}.json
ingress:
  - hostname: dash.${BASE_DOMAIN}
    service: http://127.0.0.1:3000
  - hostname: media.${BASE_DOMAIN}
    service: http://127.0.0.1:8080
  - service: http_status:404
EOF

  echo "Routing DNS..."
  "$cf_bin" tunnel route dns "$TUNNEL_NAME" "dash.${BASE_DOMAIN}" || true
  "$cf_bin" tunnel route dns "$TUNNEL_NAME" "media.${BASE_DOMAIN}" || true

  mkdir -p "$PREFIX/var/service/cloudflared"
  cat > "$PREFIX/var/service/cloudflared/run" << EOF
#!/data/data/com.termux/files/usr/bin/sh
exec $cf_bin tunnel run $TUNNEL_NAME >> $HOME/cloudflared.log 2>&1
EOF
  chmod +x "$PREFIX/var/service/cloudflared/run"
  sv-enable cloudflared 2>/dev/null || true
  sv start cloudflared 2>/dev/null || true
  echo "Cloudflare tunnel service started."
}

phase_dashboard() {
  step "Dashboard (dash.aniketdutta.space)"
  if [ ! -f "$DASH_SRC/src/index.js" ]; then
    die "Dashboard source not found at $DASH_SRC — clone the full phone-server repo"
  fi

  echo "Installing dashboard to $DASH_DIR..."
  mkdir -p "$DASH_DIR/data" "$DASH_DIR/uploads"
  rsync -a --delete \
    --exclude node_modules \
    --exclude .env \
    --exclude 'data/store.json' \
    "$DASH_SRC/" "$DASH_DIR/"

  local write_env=true
  if [ -f "$DASH_DIR/.env" ]; then
    if confirm "Existing ~/dash/.env found — keep current secrets?"; then
      write_env=false
      echo "Keeping existing .env"
    fi
  fi

  if [ "$write_env" = true ]; then
  cat > "$DASH_DIR/.env" << EOF
NODE_ENV=production
PORT=3000
BIND_HOST=127.0.0.1
BASE_DOMAIN=${BASE_DOMAIN}

ADMIN_USER=${ADMIN_USER}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
SESSION_SECRET=${SESSION_SECRET}

TUNNEL_NAME=${TUNNEL_NAME}
TUNNEL_ID=${TUNNEL_ID}

HOME_DIR=${TERMUX_HOME}
PROJECTS_FRONTEND=${TERMUX_HOME}/projects/frontend
PROJECTS_BACKEND=${TERMUX_HOME}/projects/backend
UPLOADS_DIR=${TERMUX_HOME}/uploads
CLOUDFLARED_BIN=${HOME}/cloudflared
CLOUDFLARED_CONFIG=${HOME}/.cloudflared/config.yml

PROJECT_PORT_START=3001
PROJECT_PORT_END=3999
RESERVED_PORTS=3000,5432,8080

PGDATA=${HOME}/postgres-data
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=postgres

TRUST_PROXY=true
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_LOGIN_WINDOW_MS=900000
RATE_LIMIT_API_MAX=100
RATE_LIMIT_API_WINDOW_MS=60000
UPLOAD_MAX_MB=100
EOF

  chmod 600 "$DASH_DIR/.env"
  fi

  cd "$DASH_DIR"
  npm install --production
  pm2 delete dash 2>/dev/null || true
  pm2 start src/index.js --name dash
  pm2 save

  echo "Dashboard running on 127.0.0.1:3000 (PM2: dash)"
}

phase_security_check() {
  step "Security verification"
  local pass=0 fail=0

  check() {
    local name="$1" ok="$2"
    if [ "$ok" = "ok" ]; then
      echo "  ✓ $name"
      pass=$((pass + 1))
    else
      echo "  ✗ $name"
      fail=$((fail + 1))
    fi
  }

  grep -q 'BIND_HOST=127.0.0.1' "$DASH_DIR/.env" && check "Dashboard bound to localhost" ok || check "Dashboard bound to localhost" fail
  grep -q 'NODE_ENV=production' "$DASH_DIR/.env" && check "Production mode enabled" ok || check "Production mode enabled" fail
  grep -q 'ADMIN_PASSWORD=changeme' "$DASH_DIR/.env" && check "Default password changed" fail || check "Default password changed" ok
  grep -q '"address".*"127.0.0.1"' "$HOME/filebrowser/config.json" 2>/dev/null && check "File Browser bound to localhost" ok || check "File Browser bound to localhost" fail

  if pgrep -f cloudflared >/dev/null 2>&1 || sv status cloudflared 2>/dev/null | grep -q run; then
    check "Cloudflare tunnel running" ok
  else
    check "Cloudflare tunnel running" fail
  fi

  if pm2 describe dash >/dev/null 2>&1; then
    check "Dashboard PM2 process running" ok
  else
    check "Dashboard PM2 process running" fail
  fi

  echo ""
  echo "Security checks: $pass passed, $fail failed"

  if [ "$fail" -gt 0 ]; then
    echo "Fix failed checks above before going live."
    return 1
  fi
  return 0
}

phase_done() {
  step "Setup complete"
  echo ""
  echo "  Dashboard:  https://dash.${BASE_DOMAIN}"
  echo "  Media:      https://media.${BASE_DOMAIN}"
  echo "  Admin user: ${ADMIN_USER}"
  echo ""
  echo "Required manual steps:"
  echo "  1. Enable Cloudflare Access on dash.* and media.*"
  echo "     → docs/CLOUDFLARE.md"
  echo "  2. Add WAF rate limiting on your domain"
  echo "  3. Verify LAN is blocked: http://<phone-ip>:3000 should NOT work from another device"
  echo ""
  echo "Useful commands:"
  echo "  pm2 list                          # service status"
  echo "  bash $SCRIPT_DIR/verify.sh        # run verification"
  echo "  bash $SCRIPT_DIR/backup.sh        # backup data"
  echo ""
  echo "After phone reboot:"
  echo "  sv start postgresql && sv start cloudflared && pm2 resurrect"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  require_termux

  if [ -f "$HOME/dash/.env" ] && pm2 describe dash >/dev/null 2>&1; then
    if confirm "Existing installation detected. Update dashboard code only (skip full setup)?"; then
      step "Dashboard update"
      phase_dashboard
      phase_security_check || true
      phase_done
      if confirm "Run verification now?"; then
        bash "$SCRIPT_DIR/verify.sh"
      fi
      exit 0
    fi
  fi

  phase_welcome
  phase_packages
  phase_config
  phase_storage
  phase_postgres
  phase_filebrowser
  phase_cloudflared
  phase_dashboard
  phase_security_check || true
  phase_done

  echo ""
  if confirm "Run full verification now?"; then
    bash "$SCRIPT_DIR/verify.sh"
  fi
}

main "$@"
