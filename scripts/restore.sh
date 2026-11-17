#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: scripts/restore.sh <encrypted-database-backup> <encrypted-storage-snapshot>" >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/server"
DATABASE_BACKUP="$(realpath "$1")"
STORAGE_SNAPSHOT="$(realpath "$2")"
if [[ ! -f "$DATABASE_BACKUP" || ! -f "$STORAGE_SNAPSHOT" ]]; then
  echo "Both encrypted backup files must exist" >&2
  exit 2
fi
if [[ "${RESTORE_CONFIRM:-}" != "replace" ]]; then
  echo "This replaces the configured MongoDB database. Set RESTORE_CONFIRM=replace to proceed." >&2
  exit 2
fi

node src/db/backup-storage.js restore "$STORAGE_SNAPSHOT"
npm run db:restore -- "$DATABASE_BACKUP"
