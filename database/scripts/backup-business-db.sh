#!/usr/bin/env bash
set -Eeuo pipefail

# 在腾讯云服务器上运行。需要 docker、pg_dump（容器内）和 sha256sum。
# 备份目录必须位于 PostgreSQL 数据目录之外；异机复制由部署方另行配置。
CONTAINER="${PG_DOCKER_CONTAINER:-appwrite-postgresql}"
DATABASE="${PGDATABASE:-qingyu_business}"
DB_USER="${PGUSER:-user}"
BACKUP_DIR="${BACKUP_DIR:?请设置 BACKUP_DIR，例如 /home/ubuntu/backups/qingyu}"
mkdir -p -- "$BACKUP_DIR"
test -d "$BACKUP_DIR" && test -w "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/${DATABASE}_${stamp}.dump"
temp="${target}.partial"
trap 'rm -f -- "$temp"' EXIT

docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DATABASE" \
  --format=custom --no-owner --no-acl --file=/tmp/qingyu-business.dump
docker cp "$CONTAINER:/tmp/qingyu-business.dump" "$temp"
docker exec "$CONTAINER" rm -f /tmp/qingyu-business.dump

sha256sum "$temp" > "${temp}.sha256"
mv -- "$temp" "$target"
mv -- "${temp}.sha256" "${target}.sha256"
size="$(stat -c '%s' "$target")"
checksum="$(cut -d' ' -f1 "${target}.sha256")"
printf 'backup_file=%s\nsize_bytes=%s\nsha256=%s\n' "$target" "$size" "$checksum"
