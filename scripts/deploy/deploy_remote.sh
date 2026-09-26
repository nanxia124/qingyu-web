set -euo pipefail
SITE_ROOT=${SITE_ROOT:-/var/www/qingyu-web}
BACKUP_PARENT=${BACKUP_PARENT:-/var/www}
DIST_ZIP=${DIST_ZIP:-/home/ubuntu/qingyu-web-dist.zip}
TS=$(date +%Y%m%d%H%M%S)
BACKUP_PATH="$BACKUP_PARENT/qingyu-web.bak.$TS"

prune_site_backups() {
  local backup_names backup
  local -a backups
  backup_names=$(sudo find "$BACKUP_PARENT" -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex "$BACKUP_PARENT/qingyu-web\\.bak\\.[0-9]{12,14}" -printf '%f\n' | sort -r)
  [[ -n "$backup_names" ]] || return 0
  mapfile -t backups <<< "$backup_names"
  for backup in "${backups[@]:2}"; do
    [[ "$backup" =~ ^qingyu-web\.bak\.[0-9]{12,14}$ ]] || { echo "Invalid backup path; stop cleanup: $backup" >&2; return 1; }
    echo "=== remove old backup $BACKUP_PARENT/$backup ==="
    sudo rm -rf -- "$BACKUP_PARENT/$backup"
  done
}

echo "=== backup to $BACKUP_PATH ==="
if sudo test -e "$BACKUP_PATH"; then
  echo "Backup path already exists; refusing to overwrite: $BACKUP_PATH" >&2
  exit 1
fi
sudo cp -r "$SITE_ROOT" "$BACKUP_PATH"
echo "=== unzip ==="
sudo unzip -o "$DIST_ZIP" -d "$SITE_ROOT" | tail -3
echo "=== chown ==="
sudo chown -R www-data:www-data "$SITE_ROOT"
echo "=== nginx test ==="
sudo nginx -t
echo "=== reload ==="
sudo systemctl reload nginx
echo "=== verify deployed page ==="
EXPECTED_INDEX=$(grep -oE 'index-[A-Za-z0-9_-]+\.js' "$SITE_ROOT/index.html" | sed -n '1p')
test -n "$EXPECTED_INDEX"
SERVED_INDEX=$(curl -fsS http://127.0.0.1/ | grep -oE 'index-[A-Za-z0-9_-]+\.js' | sed -n '1p')
test "$EXPECTED_INDEX" = "$SERVED_INDEX"
echo "Verified active page asset: $SERVED_INDEX"
echo "=== keep the two newest successful-deploy backups ==="
prune_site_backups
echo "=== new index.html ==="
cat "$SITE_ROOT/index.html"
echo "DEPLOY_DONE"
