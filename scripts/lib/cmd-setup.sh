# Setup command — sourced by phone.sh
# Depends on: common.sh (die, prompt, confirm, step, gen_secret, open_browser, ensure_pm2_running, …)

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
  die "Cloudflare login timed out. Re-run: bash $SCRIPT_DIR/phone.sh setup"
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

validate_media_root() {
  local raw="$1"
  local path parent

  path="$(expand_path "$raw")"

  if [ -e "$path" ]; then
    if [ ! -d "$path" ]; then
      echo "Not a directory: $path"
      return 1
    fi
  else
    parent="$(dirname "$path")"
    if [ ! -d "$parent" ]; then
      echo "Path not found: $path"
      echo "Use ~/storage/shared (run termux-setup-storage first)"
      return 1
    fi
    if ! mkdir -p "$path" 2>/dev/null; then
      echo "Permission denied: $path"
      echo "Use ~/storage/shared instead of /storage/emulated/*"
      return 1
    fi
  fi

  if [ ! -r "$path" ] || [ ! -x "$path" ]; then
    echo "Cannot read: $path — grant storage access (termux-setup-storage)"
    return 1
  fi

  # Use logical path (not pwd -P). Resolving ~/storage/shared → /storage/emulated/0
  # often breaks Termux permissions, and a buggy "pwd -P || pwd" once wrote TWO
  # paths into MEDIA_ROOT (breaking env.sh).
  MEDIA_ROOT="$(cd "$path" && pwd)"
  return 0
}

list_storage_options() {
  echo "Available storage paths:"
  local p found=false
  for p in "$HOME/storage/shared" "$HOME/storage/downloads" "$HOME/storage/dcim"; do
    if [ -d "$p" ] && [ -r "$p" ]; then
      echo "  ✓ $p"
      found=true
    fi
  done
  if [ "$found" = false ]; then
    echo "  (none yet — run termux-setup-storage and tap Allow)"
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

  prompt FB_USER "Media username" "aniket"
  while true; do
    prompt FB_PASSWORD "Media password (min 8 chars)" "" true
    if [ "${#FB_PASSWORD}" -lt 8 ]; then
      echo "Password must be at least 8 characters."
      continue
    fi
    break
  done

  SESSION_SECRET="$(gen_secret)"
  echo "Generated SESSION_SECRET."
  echo "Media folder path is set in the next step (after storage access)."
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
  mkdir -p "$HOME/logs" "$HOME/.cloudflared" "$HOME/backups" "$HOME/media-server"

  echo ""
  list_storage_options
  echo ""
  echo "Recommended: ~/storage/shared  (internal storage via Termux)"
  echo ""

  local default
  default="$(default_media_root)"

  while true; do
    prompt MEDIA_ROOT "Media files root" "$default"
    if validate_media_root "$MEDIA_ROOT"; then
      echo "Using media root: $MEDIA_ROOT"
      break
    fi
    echo "Try again."
    default="$(default_media_root)"
  done
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
  local media_src="$SCRIPT_DIR/media"

  [ -d "$media_src" ] || die "Missing $media_src"
  [ -f "$media_src/server.js" ] || die "Missing $media_src/server.js"

  mkdir -p "$media_dir"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$media_src/" "$media_dir/"
  else
    rm -rf "$media_dir"/*
    cp -r "$media_src/." "$media_dir/"
  fi

  # Quote values so passwords/paths with spaces never break sourcing
  {
    echo "export MEDIA_HOST=127.0.0.1"
    echo "export MEDIA_PORT=8080"
    echo "export MEDIA_ROOT=$(printf '%q' "$MEDIA_ROOT")"
    echo "export MEDIA_USER=$(printf '%q' "$FB_USER")"
    echo "export MEDIA_PASS=$(printf '%q' "$FB_PASSWORD")"
    echo "export MEDIA_MAX_UPLOAD_MB=10240"
  } > "$media_dir/env.sh"
  chmod 600 "$media_dir/env.sh"

  # shellcheck disable=SC1091
  set -a
  source "$media_dir/env.sh"
  set +a

  ensure_pm2_running media "$media_dir/server.js" --name media --interpreter node
  pm2 save
  echo "Media server running on 127.0.0.1:8080 (PM2: media)"
}

install_cloudflared() {
  # GitHub Linux binaries fail on Termux with "unexpected e_type: 2"
  if [ -f "$HOME/cloudflared" ]; then
    if ! "$HOME/cloudflared" --version >/dev/null 2>&1; then
      echo "Removing incompatible ~/cloudflared binary..."
      rm -f "$HOME/cloudflared"
    fi
  fi

  if command -v cloudflared >/dev/null 2>&1 && cloudflared --version >/dev/null 2>&1; then
    command -v cloudflared
    return 0
  fi

  echo "Installing cloudflared from Termux packages..."
  if ! pkg install -y cloudflared 2>/dev/null; then
    echo "Enabling tur-repo and retrying..."
    pkg install -y tur-repo
    pkg install -y cloudflared
  fi

  command -v cloudflared >/dev/null 2>&1 || die "cloudflared install failed — run: pkg install tur-repo && pkg install cloudflared"
  cloudflared --version >/dev/null 2>&1 || die "cloudflared not working after install"
  command -v cloudflared
}

phase_cloudflared() {
  step "Cloudflare Tunnel"
  local cf_bin cf_config="$HOME/.cloudflared/config.yml"

  cf_bin="$(install_cloudflared)"
  CLOUDFLARED_BIN="$cf_bin"
  echo "Using cloudflared: $cf_bin"

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
  - hostname: memory.${BASE_DOMAIN}
    service: http://127.0.0.1:8765
  - hostname: db.${BASE_DOMAIN}
    service: tcp://127.0.0.1:5432
  - service: http_status:404
EOF

    echo "Routing DNS..."
    "$cf_bin" tunnel route dns "$TUNNEL_NAME" "dash.${BASE_DOMAIN}" || true
    "$cf_bin" tunnel route dns "$TUNNEL_NAME" "media.${BASE_DOMAIN}" || true
    "$cf_bin" tunnel route dns "$TUNNEL_NAME" "memory.${BASE_DOMAIN}" || true
    "$cf_bin" tunnel route dns "$TUNNEL_NAME" "db.${BASE_DOMAIN}" || true
  else
    echo "Existing tunnel config found."
    TUNNEL_ID="$(basename "$(grep credentials-file "$cf_config" | awk '{print $2}')" .json)"
    echo "Using tunnel ID: $TUNNEL_ID"
  fi

  ensure_pm2_running tunnel "$cf_bin" --name tunnel --interpreter none -- tunnel --config "$cf_config" run "$TUNNEL_NAME"
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
CLOUDFLARED_BIN=${CLOUDFLARED_BIN:-$PREFIX/bin/cloudflared}
CLOUDFLARED_CONFIG=${HOME}/.cloudflared/config.yml

PROJECT_PORT_START=3001
PROJECT_PORT_END=3999
RESERVED_PORTS=3000,5432,8080,8765

PGDATA=${HOME}/postgres-data
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=${USER:-$(whoami)}
PGDATABASE=postgres

NGROK_ENABLED=true
NGROK_AUTHTOKEN=
NGROK_BIN=${HOME}/ngrok

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
  ensure_pm2_running dash "$DASH_DIR/src/index.js" --name dash --cwd "$DASH_DIR"
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
    check "Media PM2 process running" ok
  else
    check "Media PM2 process running" fail
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
  echo "  Memory:     https://memory.${BASE_DOMAIN}  (after: phone.sh memory setup)"
  echo "  Admin user: ${ADMIN_USER}"
  echo ""
  echo "Required manual steps:"
  echo "  1. Enable Cloudflare Access on dash.* and media.*"
  echo "  2. Add WAF rate limiting on your domain"
  echo "  3. Verify LAN is blocked: http://<phone-ip>:3000 should NOT work from another device"
  echo ""
  echo "Useful commands:"
  echo "  pm2 list                          # service status"
  echo "  bash $SCRIPT_DIR/phone.sh verify        # run verification"
  echo "  bash $SCRIPT_DIR/phone.sh backup        # backup data"
  echo ""
  echo "After phone reboot:"
  echo "  bash $SCRIPT_DIR/start.sh"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

cmd_setup() {
  require_termux

  if [ -f "$HOME/dash/.env" ] && pm2 describe dash >/dev/null 2>&1; then
    if confirm "Existing installation detected. Update dashboard code only (skip full setup)?"; then
      step "Dashboard update"
      phase_dashboard
      phase_security_check || true
      phase_done
      if confirm "Run verification now?"; then
        cmd_verify
      fi
      return 0
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
    cmd_verify
  fi
}
