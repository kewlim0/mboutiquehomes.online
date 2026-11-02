#!/usr/bin/env bash
# Copy the server's backups to THIS Mac (run it on the Mac):   bash scripts/pull-backups.sh
# - it only ADDS files here: if the server's backups were ever lost, your copies stay
# - copies older than KEEP_LOCAL_DAYS (default 90) are removed from this Mac
# - it warns when the newest backup on the server is old (= the nightly backup stopped working)
# Settings (optional): BACKUP_HOST  BACKUP_DEST  KEEP_LOCAL_DAYS
set -euo pipefail
umask 077

HOST="${BACKUP_HOST:-root@216.219.95.253}"
DEST="${BACKUP_DEST:-$HOME/Backups/mboutiquehomes}"
KEEP_LOCAL_DAYS="${KEEP_LOCAL_DAYS:-90}"

mkdir -p "$DEST"; chmod 700 "$DEST"
echo "→ pulling backups from $HOST into $DEST"
# (the rsync that comes with macOS is old (2.6.9): options go first, in the plain "--name=value" form)
rsync -a -e "ssh -o BatchMode=yes -o ConnectTimeout=20" --exclude=.lock "$HOST:/root/backups/" "$DEST/"

latest_db="$(ls -1t "$DEST"/db/db-*.sql.gz 2>/dev/null | head -1 || true)"
if [ -z "$latest_db" ]; then echo "✗ no database backup found yet (has the nightly backup run on the server?)"; exit 1; fi
gzip -t "$latest_db" || { echo "✗ the newest database backup is damaged: $latest_db"; exit 1; }

# how old is the newest one?
age_h=$(( ( $(date +%s) - $(stat -f %m "$latest_db" 2>/dev/null || stat -c %Y "$latest_db") ) / 3600 ))
if [ "$age_h" -gt 36 ]; then echo "⚠ the newest backup is $age_h hours old: the nightly backup on the server may have stopped"; fi

find "$DEST/db" -type f -name 'db-*.sql.gz' -mtime +"$KEEP_LOCAL_DAYS" -delete
find "$DEST/files" -type f -name 'files-*.tar.gz' -mtime +"$KEEP_LOCAL_DAYS" -delete 2>/dev/null || true

echo "✓ done. newest database backup: $(basename "$latest_db")  ($age_h h old)"
echo "  on this Mac: $(ls "$DEST"/db 2>/dev/null | grep -c '^db-') database backups, $(ls "$DEST"/files 2>/dev/null | grep -c '^files-') file backups  ($(du -sh "$DEST" | cut -f1))"
