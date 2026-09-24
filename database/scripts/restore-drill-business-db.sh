#!/usr/bin/env bash
set -Eeuo pipefail

# 在隔离数据库中恢复一份业务备份，验证备份真的可读、可恢复，然后删除演练库。
CONTAINER="${PG_DOCKER_CONTAINER:-appwrite-postgresql}"
DATABASE="${PGDATABASE:-qingyu_business}"
DB_USER="${PGUSER:-user}"
BACKUP_FILE="${BACKUP_FILE:?请设置 BACKUP_FILE，例如 /home/ubuntu/backups/qingyu/qingyu_business_20260923T000000Z.dump}"
DRILL_DB="${DRILL_DB:-qingyu_restore_drill_$(date -u +%Y%m%dT%H%M%SZ)}"
ENVIRONMENT="${RESTORE_DRILL_ENVIRONMENT:-isolated_server}"
REQUIRED_MIGRATION_VERSION="${REQUIRED_MIGRATION_VERSION:-0049_reconciliation_drift_and_audit_query}"
REQUIRE_OBJECT_ARCHIVE="${REQUIRE_OBJECT_ARCHIVE:-0}"
OBJECT_ARCHIVE_FILE="${OBJECT_ARCHIVE_FILE:-}"

# 数据库备份和对象归档使用同一时间戳；如果调用方没有显式指定，就尝试自动匹配。
if [[ -z "$OBJECT_ARCHIVE_FILE" ]]; then
  backup_stamp="$(basename "$BACKUP_FILE" | sed -n "s/^${DATABASE}_\\(.*\\)\\.dump$/\\1/p")"
  if [[ -n "$backup_stamp" && -f "$(dirname "$BACKUP_FILE")/qingyu_objects_${backup_stamp}.tar.gz" ]]; then
    OBJECT_ARCHIVE_FILE="$(dirname "$BACKUP_FILE")/qingyu_objects_${backup_stamp}.tar.gz"
  fi
fi
if [[ -n "$OBJECT_ARCHIVE_FILE" ]]; then
  test -r "$OBJECT_ARCHIVE_FILE"
  sha256sum -c "${OBJECT_ARCHIVE_FILE}.sha256"
  tar -tzf "$OBJECT_ARCHIVE_FILE" >/dev/null
elif [[ "$REQUIRE_OBJECT_ARCHIVE" == '1' ]]; then
  echo '要求对象归档，但没有找到对应的对象归档文件' >&2
  exit 1
fi

test -r "$BACKUP_FILE"
sha256sum -c "${BACKUP_FILE}.sha256"

backup_id="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -Atqc \
  "select id from app.backup_runs where storage_key = '$BACKUP_FILE' and status in ('succeeded','verified') order by created_at desc limit 1")"
test -n "$backup_id"
expected_schema_version="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -Atqc \
  "select coalesce(schema_version,'unknown') from app.backup_runs where id = '$backup_id'")"
drill_id="$(cat /proc/sys/kernel/random/uuid)"
started_epoch="$(date +%s)"
restored=0

record_started() {
  sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 \
    -v drill_id="$drill_id" -v backup_id="$backup_id" -v environment="$ENVIRONMENT" \
    -f - >/dev/null <<'SQL'
insert into app.restore_drills(id,backup_id,environment,status,target_time)
values (:'drill_id',:'backup_id',:'environment','started',now());
SQL
}
record_failed() {
  sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 \
    -v drill_id="$drill_id" -v error_message="${1:-restore drill failed}" \
    -f - >/dev/null <<'SQL' || true
update app.restore_drills
set status='failed',completed_at=now(),error_message=:'error_message'
where id=:'drill_id';
SQL
}
cleanup() {
  if [ "$restored" -eq 1 ]; then
    sudo docker exec "$CONTAINER" dropdb -U "$DB_USER" --if-exists "$DRILL_DB" >/dev/null || true
  fi
  sudo docker exec "$CONTAINER" rm -f "/tmp/$(basename "$BACKUP_FILE")" >/dev/null 2>&1 || true
}
trap 'record_failed "restore drill failed"; cleanup' ERR

record_started
sudo docker exec "$CONTAINER" createdb -U "$DB_USER" "$DRILL_DB"
restored=1
sudo docker cp "$BACKUP_FILE" "$CONTAINER:/tmp/$(basename "$BACKUP_FILE")"
sudo docker exec "$CONTAINER" pg_restore -U "$DB_USER" -d "$DRILL_DB" --no-owner --no-acl "/tmp/$(basename "$BACKUP_FILE")"

table_count="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DRILL_DB" -Atqc \
  "select count(*) from information_schema.tables where table_schema='app'")"
schema_version="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DRILL_DB" -Atqc \
  "select coalesce(max(version),'unknown') from app.schema_migrations")"
test "$table_count" -ge 1
test "$schema_version" = "$expected_schema_version"
required_migration="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DRILL_DB" -Atqc \
  "select case when exists (select 1 from app.schema_migrations where version='$REQUIRED_MIGRATION_VERSION') then 'ok' else 'failed' end")"
test "$required_migration" = "ok"
rto_seconds="$(( $(date +%s) - started_epoch ))"
object_archive_checked=false
if [[ -n "$OBJECT_ARCHIVE_FILE" ]]; then object_archive_checked=true; fi

sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 \
  -v drill_id="$drill_id" -v rto_seconds="$rto_seconds" -v table_count="$table_count" \
  -v schema_version="$schema_version" -v required_migration="$REQUIRED_MIGRATION_VERSION" \
  -v object_archive_checked="$object_archive_checked" -f - >/dev/null <<'SQL'
update app.restore_drills
set status='passed',restored_at=now(),completed_at=now(),rpo_seconds=0,rto_seconds=:'rto_seconds',
    checks=jsonb_build_object('app_table_count', :'table_count'::int, 'schema_version', :'schema_version', 'required_migration', :'required_migration', 'checksum_verified', true, 'object_archive_checked', :'object_archive_checked'::boolean)
where id=:'drill_id';
SQL

cleanup
restored=0
printf 'restore_drill_id=%s\napp_table_count=%s\nschema_version=%s\nrto_seconds=%s\nobject_archive_checked=%s\n' \
  "$drill_id" "$table_count" "$schema_version" "$rto_seconds" "$object_archive_checked"
