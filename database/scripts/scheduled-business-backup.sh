#!/usr/bin/env bash
set -Eeuo pipefail

# 每日任务入口：先生成可校验备份，再按需复制到已配置的镜像目录，最后删除旧文件。
# BACKUP_MIRROR_DIR 不配置时只保留本机备份；配置后必须是已挂载的异机/独立存储目录。
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
export PG_DOCKER_CONTAINER="${PG_DOCKER_CONTAINER:-appwrite-postgresql}"
export PGDATABASE="${PGDATABASE:-qingyu_business}"
export PGUSER="${PGUSER:-user}"
export BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/qingyu}"
export BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
export OBJECT_DIR="${OBJECT_DIR:-/home/ubuntu/qingyu-api/api-data/objects}"

backup_output="$($SCRIPT_DIR/backup-business-db.sh)"
printf '%s\n' "$backup_output"
backup_file="$(awk -F= '$1=="backup_file" {print $2}' <<<"$backup_output")"
if [[ -z "$backup_file" || ! -f "$backup_file" ]]; then
  echo '备份脚本没有返回有效的数据库备份文件' >&2
  exit 1
fi
backup_stamp="$(basename "$backup_file" | sed -n "s/^${PGDATABASE}_\\(.*\\)\\.dump$/\\1/p")"
if [[ -z "$backup_stamp" ]]; then
  echo '无法从数据库备份文件名解析时间戳，拒绝生成无法自动配对的对象归档' >&2
  exit 1
fi

# 文件本体和数据库元数据一起归档。数据库备份成功但对象归档失败时，后面的镜像步骤会明确失败，避免留下“记录在、文件不在”的假完整备份。
object_archive=""
if [[ -d "$OBJECT_DIR" ]]; then
  object_archive="$BACKUP_DIR/qingyu_objects_${backup_stamp}.tar.gz"
  tar -czf "$object_archive" -C "$OBJECT_DIR" .
  sha256sum "$object_archive" > "$object_archive.sha256"
fi

mirror_backup() {
  local mirror_root="$1"
  local storage_provider='mounted_mirror'
  local mirror_file="$mirror_root/$(basename "$backup_file")"
  local backup_id copy_id checksum size_bytes
  mkdir -p -- "$mirror_root"
  backup_id="$(sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -Atqc \
    "select id from app.backup_runs where storage_key='$backup_file' order by created_at desc limit 1")"
  if [[ -z "$backup_id" ]]; then
    echo '找不到刚生成的备份记录，无法登记副本' >&2
    return 1
  fi
  copy_id="$(sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -Atqc \
    "insert into app.backup_copies(backup_id,storage_provider,storage_key,status) values('$backup_id','$storage_provider','$mirror_file','started') on conflict (backup_id,storage_provider,storage_key) do update set status='started',error_message=null returning id")"
  if ! cp -- "$backup_file" "$mirror_file" || ! cp -- "$backup_file.sha256" "$mirror_file.sha256"; then
    sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
      "update app.backup_copies set status='failed',error_message='复制备份文件失败' where id='$copy_id';" >/dev/null
    return 1
  fi
  checksum="$(cut -d' ' -f1 "$mirror_file.sha256")"
  size_bytes="$(stat -c '%s' "$mirror_file")"
  if ! (cd "$(dirname "$mirror_file")" && sha256sum --check "$(basename "$mirror_file").sha256"); then
    sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
      "update app.backup_copies set status='failed',error_message='副本 SHA-256 校验失败' where id='$copy_id';" >/dev/null
    return 1
  fi
  updated_rows="$(sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -Atqc \
    "update app.backup_copies set status='verified',checksum_sha256='$checksum',size_bytes=$size_bytes,uploaded_at=now(),verified_at=now(),error_message=null where id='$copy_id' returning id")"
  if [[ "$updated_rows" != "$copy_id" ]]; then
    echo '副本校验通过，但数据库状态没有成功更新' >&2
    return 1
  fi
  printf 'mirror_copy=verified\nstorage_key=%s\n' "$mirror_file"

  if [[ -n "$object_archive" ]]; then
    local object_mirror="$mirror_root/$(basename "$object_archive")"
    local object_copy_id object_checksum object_size
    object_copy_id="$(sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -Atqc \
      "insert into app.backup_copies(backup_id,storage_provider,storage_key,status) values('$backup_id','$storage_provider','$object_mirror','started') on conflict (backup_id,storage_provider,storage_key) do update set status='started',error_message=null returning id")"
    if ! cp -- "$object_archive" "$object_mirror" || ! cp -- "$object_archive.sha256" "$object_mirror.sha256"; then
      sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
        "update app.backup_copies set status='failed',error_message='对象归档复制失败' where id='$object_copy_id';" >/dev/null
      return 1
    fi
    object_checksum="$(cut -d' ' -f1 "$object_mirror.sha256")"
    object_size="$(stat -c '%s' "$object_mirror")"
    if ! (cd "$(dirname "$object_mirror")" && sha256sum --check "$(basename "$object_mirror").sha256"); then
      sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
        "update app.backup_copies set status='failed',error_message='对象归档 SHA-256 校验失败' where id='$object_copy_id';" >/dev/null
      return 1
    fi
    sudo docker exec "$PG_DOCKER_CONTAINER" psql -U "$PGUSER" -d "$PGDATABASE" -v ON_ERROR_STOP=1 -c \
      "update app.backup_copies set status='verified',checksum_sha256='$object_checksum',size_bytes=$object_size,uploaded_at=now(),verified_at=now(),error_message=null where id='$object_copy_id';" >/dev/null
    printf 'object_mirror_copy=verified\nstorage_key=%s\n' "$object_mirror"
  fi
}

if [[ -n "${BACKUP_MIRROR_DIR:-}" ]]; then
  if ! mirror_backup "$BACKUP_MIRROR_DIR"; then
    echo '异机镜像复制失败，已写入 backup_copies.failed' >&2
    exit 1
  fi
fi

find "$BACKUP_DIR" -maxdepth 1 -type f \
  \( -name "${PGDATABASE}_*.dump" -o -name "${PGDATABASE}_*.dump.sha256" -o -name "qingyu_objects_*.tar.gz" -o -name "qingyu_objects_*.tar.gz.sha256" \) \
  -mtime "+$BACKUP_RETENTION_DAYS" -print -delete
