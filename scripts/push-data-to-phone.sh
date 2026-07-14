#!/usr/bin/env bash
# Push memory-engine/data (~2.5 GB) from this Mac to the phone.
#
#   bash scripts/push-data-to-phone.sh --adb          # USB (recommended)
#   bash scripts/push-data-to-phone.sh user@PHONE_IP  # rsync over SSH
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_SRC="$REPO_ROOT/memory-engine/data"
TAR="$REPO_ROOT/memory-engine-data.tar"
ADB="${ADB:-adb}"
command -v adb >/dev/null 2>&1 || ADB="/Users/aniketdutta/Library/Android/sdk/platform-tools/adb"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$DATA_SRC/memory.db" ] || die "Missing $DATA_SRC/memory.db"

if [ "${1:-}" = "--adb" ]; then
  [ -x "$ADB" ] || command -v "$ADB" >/dev/null 2>&1 || die "adb not found"
  "$ADB" get-state >/dev/null 2>&1 || die "No device — plug in USB and enable debugging"

  echo "Creating archive..."
  rm -f "$TAR"
  tar -cf "$TAR" -C "$(dirname "$DATA_SRC")" data
  ls -lh "$TAR"

  echo "Pushing to /sdcard/Download/memory-engine-data.tar ..."
  "$ADB" push "$TAR" /sdcard/Download/memory-engine-data.tar

  cat <<'EOF'

On the phone (Termux):

  mkdir -p ~/pocket-server/memory-engine
  cd ~/pocket-server/memory-engine
  tar -xf ~/storage/shared/Download/memory-engine-data.tar
  # that creates ./data/ — verify:
  ls -lh data/memory.db data/vectors.faiss

  bash ~/pocket-server/scripts/setup-memory-engine.sh
  bash ~/pocket-server/scripts/pm2-memory-engine.sh
  pm2 list
EOF
  exit 0
fi

TARGET="${1:-}"
[ -n "$TARGET" ] || die "Usage: $0 --adb   OR   $0 user@PHONE_IP"

REMOTE_DIR="~/pocket-server/memory-engine/data"
echo "Syncing $DATA_SRC  ->  $TARGET:$REMOTE_DIR"
ssh "$TARGET" "mkdir -p $REMOTE_DIR"
rsync -avz --progress --partial "$DATA_SRC/" "$TARGET:$REMOTE_DIR/"
echo "Done. On phone: bash ~/pocket-server/scripts/setup-memory-engine.sh"
