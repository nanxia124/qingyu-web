#!/usr/bin/env bash
set -Eeuo pipefail

# 每日任务入口：先生成可校验备份，再删除超过保留期的旧文件。
# 异机复制不在这里做，避免把云存储凭据写进服务器脚本。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PG_DOCKER_CONTAINER="${PG_DOCKER_CONTAINER:-appwrite-postgresql}"
export PGDATABASE="${PGDATABASE:-qingyu_business}"
export PGUSER="${PGUSER:-user}"
export BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/qingyu}"
export BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

"$SCRIPT_DIR/backup-business-db.sh"

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name "${PGDATABASE}_*.dump" -o -name "${PGDATABASE}_*.dump.sha256" \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -print -delete
