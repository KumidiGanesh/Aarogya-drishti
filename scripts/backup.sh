#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/server"

BACKUP_DIR="$(node -e "require('dotenv').config({path:'../.env'}); process.stdout.write(process.env.BACKUP_DIR || './backups')")"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
if [[ ! "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
  echo "RETENTION_DAYS must be a positive integer" >&2
  exit 2
fi
if [[ -z "$BACKUP_DIR" || "$BACKUP_DIR" == "/" || "$BACKUP_DIR" == "." ]]; then
  echo "Refusing to use an unsafe backup directory: $BACKUP_DIR" >&2
  exit 2
fi

npm run db:backup
node src/db/backup-storage.js backup "$BACKUP_DIR"
find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name 'aarogya-*.dump.aesgcm' -o -name 'aarogya-*.storage.tar.aesgcm' \) \
  -mtime "+$RETENTION_DAYS" -delete
