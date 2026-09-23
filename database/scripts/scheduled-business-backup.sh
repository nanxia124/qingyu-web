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
export OBJECT_DIR="${OBJECT_DIR:-/home/ubuntu/qingyu-api/api-data/objects}"

"$SCRIPT_DIR/backup-business-db.sh"

# 文件本体与数据库元数据一起备份。对象键保留原目录结构，恢复后可直接放回对象目录。
if [[ -d "$OBJECT_DIR" ]]; then
  object_stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  object_archive="$BACKUP_DIR/qingyu_objects_${object_stamp}.tar.gz"
  tar -czf "$object_archive" -C "$OBJECT_DIR" .
  sha256sum "$object_archive" > "$object_archive.sha256"
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name "${PGDATABASE}_*.dump" -o -name "${PGDATABASE}_*.dump.sha256" -o -name "qingyu_objects_*.tar.gz" -o -name "qingyu_objects_*.tar.gz.sha256" \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -print -delete
