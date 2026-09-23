#!/usr/bin/env bash
set -Eeuo pipefail

# 在隔离数据库中恢复一份业务备份，验证备份真的可读、可恢复，然后删除演练库。
CONTAINER="${PG_DOCKER_CONTAINER:-appwrite-postgresql}"
DATABASE="${PGDATABASE:-qingyu_business}"
DB_USER="${PGUSER:-user}"
BACKUP_FILE="${BACKUP_FILE:?请设置 BACKUP_FILE，例如 /home/ubuntu/backups/qingyu/qingyu_business_20260923T000000Z.dump}"
DRILL_DB="${DRILL_DB:-qingyu_restore_drill_$(date -u +%Y%m%dT%H%M%SZ)}"
ENVIRONMENT="${RESTORE_DRILL_ENVIRONMENT:-isolated_server}"

test -r "$BACKUP_FILE"
sha256sum -c "${BACKUP_FILE}.sha256"

backup_id="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -Atqc \
  "select id from app.backup_runs where storage_key = '$BACKUP_FILE' and status in ('succeeded','verified') order by created_at desc limit 1")"
test -n "$backup_id"
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
test "$schema_version" = "0014_organization_lifecycle"
rto_seconds="$(( $(date +%s) - started_epoch ))"

sudo docker exec -i "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 \
  -v drill_id="$drill_id" -v rto_seconds="$rto_seconds" -v table_count="$table_count" \
  -v schema_version="$schema_version" -f - >/dev/null <<'SQL'
update app.restore_drills
set status='passed',restored_at=now(),completed_at=now(),rpo_seconds=0,rto_seconds=:'rto_seconds',
    checks=jsonb_build_object('app_table_count', :'table_count'::int, 'schema_version', :'schema_version', 'checksum_verified', true)
where id=:'drill_id';
SQL

cleanup
restored=0
printf 'restore_drill_id=%s\napp_table_count=%s\nschema_version=%s\nrto_seconds=%s\n' \
  "$drill_id" "$table_count" "$schema_version" "$rto_seconds"
