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

open_browser() {
  local url="$1"
  if command -v termux-open-url >/dev/null 2>&1; then
    termux-open-url "$url"
  else
    echo "Open this URL in your browser:"
    echo "$url"
  fi
}

ensure_pm2_running() {
  local name="$1" bin="$2"
  shift 2
  pm2 delete "$name" 2>/dev/null || true
  pm2 start "$bin" --name "$name" --interpreter none -- "$@"
  sleep 2
  if pm2 describe "$name" 2>/dev/null | grep -qE 'status.*online'; then
    return 0
  fi
  echo "PM2 logs for $name:"
  pm2 logs "$name" --lines 25 --nostream 2>/dev/null || true
  die "$name failed to start — see logs above"
}

cf_tunnel_login() {
  local cf_bin="$1"
  local cert="$HOME/.cloudflared/cert.pem"
  if [ -f "$cert" ]; then
    echo "Cloudflare account already linked."
    return 0
  fi

  local log="$HOME/.cloudflared/login.log"
  mkdir -p "$HOME/.cloudflared"
  : >"$log"

  echo "Starting Cloudflare login..."
  "$cf_bin" tunnel login >>"$log" 2>&1 &
  local pid=$!

  local url="" i
  for i in $(seq 1 60); do
    url=$(grep -oE 'https://[^[:space:]]+' "$log" 2>/dev/null | grep -i cloudflare | head -1)
    [ -n "$url" ] && break
    sleep 1
  done

  if [ -n "$url" ]; then
    echo "Opening Cloudflare login in your phone browser..."
    open_browser "$url"
  else
    echo "Could not detect login URL — opening Cloudflare dashboard..."
    open_browser "https://dash.cloudflare.com/profile/authentication"
    echo "If login fails, run manually: $cf_bin tunnel login"
  fi

  echo "Complete login in browser (select $BASE_DOMAIN), waiting..."
  for i in $(seq 1 180); do
    if [ -f "$cert" ]; then
      wait "$pid" 2>/dev/null || true
      echo "Cloudflare login successful."
      return 0
    fi
    sleep 2
  done

  kill "$pid" 2>/dev/null || true
  die "Cloudflare login timed out. Re-run: bash $SCRIPT_DIR/setup.sh"
}

cf_tunnel_ensure() {
  local cf_bin="$1" name="$2"
  if "$cf_bin" tunnel list 2>/dev/null | grep -qw "$name"; then
    echo "Tunnel '$name' already exists."
    return 0
  fi
  echo "Creating tunnel '$name'..."
  "$cf_bin" tunnel create "$name"
}

cf_tunnel_id() {
  local cf_bin="$1" name="$2"
  "$cf_bin" tunnel list 2>/dev/null | awk -v n="$name" '$0 ~ n {print $1; exit}'
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
  pkg install -y \
    git nodejs-lts python postgresql openssh curl wget tmux unzip \
    termux-services openssl rsync

  for cmd in git node npm psql initdb pg_ctl curl wget unzip rsync openssl; do
    command -v "$cmd" >/dev/null 2>&1 || die "Missing required command after install: $cmd"
  done

  if ! command -v pm2 >/dev/null 2>&1; then
    echo "Installing PM2..."
    npm install -g pm2
  fi
  command -v pm2 >/dev/null 2>&1 || die "PM2 install failed — check network and retry"

  if command -v service-daemon >/dev/null 2>&1; then
    service-daemon start 2>/dev/null || true
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
    initdb -D "$pgdata" --locale=C --encoding=UTF8
  fi

  if pg_ctl -D "$pgdata" status >/dev/null 2>&1; then
    echo "PostgreSQL already running."
  else
    pg_ctl -D "$pgdata" -l "$HOME/postgres.log" start || true
  fi

  psql -l >/dev/null 2>&1 || die "PostgreSQL failed to start. Check ~/postgres.log"
  echo "PostgreSQL is running."
}

phase_media() {
  step "Media server (media.${BASE_DOMAIN})"
  local media_dir="$HOME/media-server"
  local media_script="$SCRIPT_DIR/media-server.js"

  [ -f "$media_script" ] || die "Missing $media_script"

  mkdir -p "$media_dir"
  cp "$media_script" "$media_dir/media-server.js"

  cat > "$media_dir/env.sh" << EOF
export MEDIA_HOST=127.0.0.1
export MEDIA_PORT=8080
export MEDIA_ROOT=$MEDIA_ROOT
export MEDIA_USER=$FB_USER
export MEDIA_PASS=$FB_PASSWORD
EOF
  chmod 600 "$media_dir/env.sh"

  cat > "$media_dir/run.sh" << EOF
#!/data/data/com.termux/files/usr/bin/bash
set -a
source "$media_dir/env.sh"
set +a
exec node "$media_dir/media-server.js"
EOF
  chmod 700 "$media_dir/run.sh"

  ensure_pm2_running media "$media_dir/run.sh"
  pm2 save
  echo "Media server running on 127.0.0.1:8080 (PM2: media)"
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

  if [ ! -f "$cf_config" ] || ! grep -q "^tunnel:" "$cf_config" 2>/dev/null; then
    cf_tunnel_login "$cf_bin"
    cf_tunnel_ensure "$cf_bin" "$TUNNEL_NAME"
    TUNNEL_ID="$(cf_tunnel_id "$cf_bin" "$TUNNEL_NAME")"
    [ -n "$TUNNEL_ID" ] || die "Could not read tunnel ID — run: $cf_bin tunnel list"

    if [ ! -f "$HOME/.cloudflared/${TUNNEL_ID}.json" ]; then
      die "Credentials missing: ~/.cloudflared/${TUNNEL_ID}.json"
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
  else
    echo "Existing tunnel config found."
    TUNNEL_ID="$(basename "$(grep credentials-file "$cf_config" | awk '{print $2}')" .json)"
    echo "Using tunnel ID: $TUNNEL_ID"
  fi

  ensure_pm2_running tunnel "$cf_bin" tunnel run "$TUNNEL_NAME"
  pm2 save
  echo "Cloudflare tunnel running (PM2: tunnel)"
}

phase_dashboard() {
  step "Dashboard (dash.${BASE_DOMAIN})"
  if [ ! -f "$DASH_SRC/src/index.js" ]; then
    die "Dashboard source not found at $DASH_SRC — clone the full phone-server repo"
  fi

  echo "Installing dashboard to $DASH_DIR..."
  mkdir -p "$DASH_DIR/data" "$DASH_DIR/uploads"
  command -v rsync >/dev/null 2>&1 || die "rsync not found — run: pkg install rsync"
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
  ensure_pm2_running dash node src/index.js
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
  grep -q 'MEDIA_HOST=127.0.0.1' "$HOME/media-server/env.sh" 2>/dev/null && check "Media server bound to localhost" ok || check "Media server bound to localhost" fail

  if pm2 describe dash 2>/dev/null | grep -qE 'status.*online'; then
    check "Dashboard PM2 process running" ok
  else
    check "Dashboard PM2 process running" fail
  fi

  if pm2 describe media 2>/dev/null | grep -qE 'status.*online'; then
    check "File Browser PM2 process running" ok
  else
    check "File Browser PM2 process running" fail
  fi

  if pm2 describe tunnel 2>/dev/null | grep -qE 'status.*online'; then
    check "Cloudflare tunnel running" ok
  else
    check "Cloudflare tunnel running" fail
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
  echo "  pg_ctl -D ~/postgres-data start && pm2 resurrect"
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
  phase_media
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
