# Backup command — sourced by phone.sh

cmd_backup() {
  local BACKUP_DIR="$HOME/backups/$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$BACKUP_DIR"

  echo "==> Backing up to $BACKUP_DIR"

  tar -czf "$BACKUP_DIR/dash.tar.gz" -C "$HOME" dash 2>/dev/null || true
  tar -czf "$BACKUP_DIR/projects.tar.gz" -C "$HOME" projects 2>/dev/null || true
  tar -czf "$BACKUP_DIR/cloudflared.tar.gz" -C "$HOME" .cloudflared 2>/dev/null || true
  tar -czf "$BACKUP_DIR/postgres-data.tar.gz" -C "$HOME" postgres-data 2>/dev/null || true
  tar -czf "$BACKUP_DIR/media-server.tar.gz" -C "$HOME" media-server 2>/dev/null || true

  if command -v pm2 >/dev/null 2>&1; then
    pm2 save 2>/dev/null || true
    cp ~/.pm2/dump.pm2 "$BACKUP_DIR/pm2-dump.pm2" 2>/dev/null || true
  fi

  echo "==> Backup complete: $BACKUP_DIR"
  ls -lh "$BACKUP_DIR"
}
