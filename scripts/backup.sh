#!/usr/bin/env bash
# Nightly backup, run ON THE SERVER by cron (see scripts/BACKUP.md):
#   1) the whole MySQL database           -> $BACKUP_DIR/db/db-<time>.sql.gz
#   2) the uploaded pictures + contracts  -> $BACKUP_DIR/files/files-<time>.tar.gz   (uploads/ and private-files/)
# Backups older than KEEP_DAYS (default 14) are removed, but ONLY after a new backup was made and checked: when something
# goes wrong the old backups stay untouched and the script exits with an error (logged in $BACKUP_DIR/backup.log).
# The folder is readable by root only (the contracts and the tenant details are private).
#
# Settings (all optional):  APP_DIR  BACKUP_DIR  KEEP_DAYS  ENV_FILE
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-/root/backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
STAMP="$(date +%Y%m%d-%H%M%S)"

log() { echo "$(date '+%F %T') $*"; }

mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files"
chmod 700 "$BACKUP_DIR" "$BACKUP_DIR/db" "$BACKUP_DIR/files"

# only one backup at a time
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { log "another backup is still running, skipping this one"; exit 0; }

CNF=""; PARTS=()
cleanup() { [ -n "$CNF" ] && rm -f "$CNF"; for f in "${PARTS[@]:-}"; do [ -n "$f" ] && rm -f "$f"; done; }
trap cleanup EXIT
trap 'log "FAILED (line $LINENO): nothing was deleted, the previous backups are untouched"' ERR

# the database login comes from the app's own .env (never printed, never put on a command line)
envval() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | tr -d '\r' | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"; }
[ -r "$ENV_FILE" ] || { log "FAILED: cannot read $ENV_FILE"; exit 1; }
DB_HOST="$(envval DB_HOST)"; DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="$(envval DB_PORT)"; DB_PORT="${DB_PORT:-3306}"
DB_USER="$(envval DB_USER)"; DB_PASSWORD="$(envval DB_PASSWORD)"; DB_NAME="$(envval DB_NAME)"
[ -n "$DB_USER" ] && [ -n "$DB_NAME" ] || { log "FAILED: DB_USER / DB_NAME missing in $ENV_FILE"; exit 1; }

esc() { local s="${1//\\/\\\\}"; printf '%s' "${s//\"/\\\"}"; }   # for a value inside "..." of a MySQL option file
CNF="$(mktemp)"; chmod 600 "$CNF"
printf '[client]\nhost="%s"\nport=%s\nuser="%s"\npassword="%s"\n' "$(esc "$DB_HOST")" "$DB_PORT" "$(esc "$DB_USER")" "$(esc "$DB_PASSWORD")" > "$CNF"

# ---- 1. database ----
DB_OUT="$BACKUP_DIR/db/db-$STAMP.sql.gz"; PARTS+=("$DB_OUT.part")
mysqldump --defaults-extra-file="$CNF" --single-transaction --quick --routines --triggers --events --no-tablespaces \
  --set-gtid-purged=OFF --default-character-set=utf8mb4 "$DB_NAME" | gzip -9 > "$DB_OUT.part"
gzip -t "$DB_OUT.part"
gzip -dc "$DB_OUT.part" | tail -n 5 | grep -q "Dump completed" || { log "FAILED: the dump is incomplete"; exit 1; }
[ "$(stat -c %s "$DB_OUT.part" 2>/dev/null || stat -f %z "$DB_OUT.part")" -gt 1000 ] || { log "FAILED: the dump is suspiciously small"; exit 1; }
mv "$DB_OUT.part" "$DB_OUT"

# ---- 2. uploaded files (pictures + contracts) ----
FILES_OUT="$BACKUP_DIR/files/files-$STAMP.tar.gz"; PARTS+=("$FILES_OUT.part")
DIRS=(); for d in uploads private-files; do [ -d "$APP_DIR/$d" ] && DIRS+=("$d"); done
if [ "${#DIRS[@]}" -gt 0 ]; then
  tar -czf "$FILES_OUT.part" -C "$APP_DIR" "${DIRS[@]}"
  gzip -t "$FILES_OUT.part"
  mv "$FILES_OUT.part" "$FILES_OUT"
fi

# ---- 3. only now: forget the old ones ----
find "$BACKUP_DIR/db" -maxdepth 1 -type f -name 'db-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR/files" -maxdepth 1 -type f -name 'files-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

human() { du -h "$1" 2>/dev/null | cut -f1; }
log "ok  database $(human "$DB_OUT")  files $( [ -f "$FILES_OUT" ] && human "$FILES_OUT" || echo '-')  | kept: $(ls "$BACKUP_DIR/db" | grep -c '^db-') database backups"
