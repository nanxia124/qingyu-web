#!/usr/bin/env bash
set -Eeuo pipefail

# 在腾讯云服务器上运行。需要 docker、age 和 sha256sum。服务端仅保存公钥。
CONTAINER="${PG_DOCKER_CONTAINER:-appwrite-postgresql}"
DATABASE="${PGDATABASE:-qingyu_business}"
DB_USER="${PGUSER:-user}"
BACKUP_DIR="${BACKUP_DIR:?请设置 BACKUP_DIR，例如 /home/ubuntu/backups/qingyu}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:?请设置 age 公钥 BACKUP_AGE_RECIPIENT}"
BACKUP_AGE_KEY_VERSION="${BACKUP_AGE_KEY_VERSION:?请设置密钥版本标记 BACKUP_AGE_KEY_VERSION}"
command -v age >/dev/null || { echo '未安装 age，拒绝生成未加密备份' >&2; exit 1; }
mkdir -p -- "$BACKUP_DIR"
test -d "$BACKUP_DIR" && test -w "$BACKUP_DIR"
chmod 700 -- "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIR/${DATABASE}_${stamp}.dump.age"
temp="${target}.partial"
schema_version="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -Atqc "select coalesce(max(version),'unknown') from app.schema_migrations")"
backup_id="$(cat /proc/sys/kernel/random/uuid)"
record_started() {
  sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 \
    -v backup_id="$backup_id" -v schema_version="$schema_version" -v storage_key="$target" \
    -v key_version="$BACKUP_AGE_KEY_VERSION" \
    -f - >/dev/null <<'SQL'
insert into app.backup_runs(id,backup_type,scope,status,source_database,schema_version,storage_provider,storage_key,encryption_key_version)
values (:'backup_id','logical','business','started',current_database(),:'schema_version','local_server',:'storage_key',:'key_version');
SQL
}
record_failed() {
  sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 \
    -v backup_id="$backup_id" -v error_message="${1:-backup failed}" \
    -f - >/dev/null <<'SQL' || true
update app.backup_runs
set status='failed',finished_at=now(),error_message=:'error_message'
where id=:'backup_id';
SQL
}
trap 'rm -f -- "$temp" "$temp.sha256"; record_failed "backup command failed"' ERR
record_started

sudo docker exec "$CONTAINER" pg_dump -U "$DB_USER" -d "$DATABASE" \
  --format=custom --no-owner --no-acl | age -r "$BACKUP_AGE_RECIPIENT" -o "$temp"
mv -- "$temp" "$target"
sha256sum "$target" > "${target}.sha256"
chmod 600 -- "$target" "${target}.sha256"
size="$(stat -c '%s' "$target")"
checksum="$(cut -d' ' -f1 "${target}.sha256")"
sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 \
  -v backup_id="$backup_id" -v checksum="$checksum" -v size_bytes="$size" \
  -f - >/dev/null <<'SQL'
update app.backup_runs
set status='succeeded',finished_at=now(),checksum_sha256=:'checksum',size_bytes=:'size_bytes'
where id=:'backup_id';
SQL
printf 'backup_file=%s\nsize_bytes=%s\nsha256=%s\nencryption=age\nkey_version=%s\n' "$target" "$size" "$checksum" "$BACKUP_AGE_KEY_VERSION"
