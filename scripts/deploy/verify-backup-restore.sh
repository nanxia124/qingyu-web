#!/usr/bin/env bash
set -Eeuo pipefail

# 只验证最近一份业务库备份能否恢复到临时数据库。
# 不连接生产业务库写数据；结束时一定删除临时库和容器内临时文件。
CONTAINER="${PG_DOCKER_CONTAINER:-appwrite-postgresql}"
DB_USER="${PGUSER:-user}"
BACKUP_DIR="${BACKUP_DIR:-/home/ubuntu/backups/qingyu}"
DATABASE="${PGDATABASE:-qingyu_business}"
REQUIRED_MIGRATION_VERSION="${REQUIRED_MIGRATION_VERSION:-0049_reconciliation_drift_and_audit_query}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
verify_db="${DATABASE}_restore_verify_${stamp//[^a-zA-Z0-9_]/_}"
dump_file="$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "${DATABASE}_*.dump" -printf '%T@ %p\n' | sort -nr | head -n1 | cut -d' ' -f2- || true)"
container_dump="/tmp/${verify_db}.dump"
backup_id="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -Atqc "select id from app.backup_runs where storage_key='${dump_file//\'/\'\'}' order by created_at desc limit 1" || true)"
drill_id=""

if [[ -z "$dump_file" || ! -f "$dump_file" ]]; then
  echo "没有找到可验证的备份文件" >&2
  exit 1
fi
if [[ ! -f "${dump_file}.sha256" ]]; then
  echo "备份缺少 SHA-256 校验文件：${dump_file}" >&2
  exit 1
fi
sha256sum --check "${dump_file}.sha256"

cleanup() {
  set +e
  sudo docker exec "$CONTAINER" rm -f "$container_dump" >/dev/null 2>&1
  sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists \"$verify_db\";" >/dev/null 2>&1
}
record_failed() {
  if [[ -n "$drill_id" ]]; then
    sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 -c "update app.restore_drills set status='failed',completed_at=now(),error_message='restore verification failed' where id='$drill_id' and status='started';" >/dev/null 2>&1 || true
  fi
}
trap 'status=$?; if [[ "$status" -ne 0 ]]; then record_failed; fi; cleanup; exit "$status"' EXIT

if [[ -n "$backup_id" ]]; then
  drill_id="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -Atqc "insert into app.restore_drills(backup_id,environment,status,target_time) values('$backup_id','temporary-container','started',now()) returning id")"
fi

sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 -c "create database \"$verify_db\";" >/dev/null
sudo docker cp "$dump_file" "$CONTAINER:$container_dump"
sudo docker exec "$CONTAINER" pg_restore -U "$DB_USER" -d "$verify_db" --no-owner --no-acl "$container_dump"

result="$(sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$verify_db" -Atqc "
select 'schema_migrations=' || count(*) from app.schema_migrations;
select 'required_migration=' || case when exists (select 1 from app.schema_migrations where version='${REQUIRED_MIGRATION_VERSION}') then 'ok' else 'failed' end;
select 'tables=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r';
select 'rls_tables=' || count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='app' and c.relkind='r' and c.relrowsecurity;
select 'sentinel=' || case when to_regclass('app.user_accounts') is not null and to_regclass('app.backup_runs') is not null then 'ok' else 'failed' end;")"
printf '%s\n' "$result"
if ! grep -q '^sentinel=ok$' <<<"$result"; then
  echo "恢复后的结构检查失败" >&2
  exit 1
fi
if ! grep -q '^required_migration=ok$' <<<"$result"; then
  echo "恢复后的备份缺少必需迁移：$REQUIRED_MIGRATION_VERSION" >&2
  exit 1
fi
if [[ -n "$drill_id" ]]; then
  sudo docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DATABASE" -v ON_ERROR_STOP=1 -c "update app.restore_drills set status='passed',restored_at=now(),completed_at=now(),checks='$(printf '%s' "$result" | jq -Rs .)'::jsonb where id='$drill_id'; update app.backup_runs set status='verified',verified_at=now() where id='$backup_id' and status='succeeded';" >/dev/null
fi
echo "PASS: 备份校验、临时恢复和结构检查完成；临时数据库已清理"
