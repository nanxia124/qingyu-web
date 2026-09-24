#!/usr/bin/env bash
# 验证真实脚本的告警函数参数，不连接生产数据库。
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf -- "$work"' EXIT
export PG_DOCKER_CONTAINER=test PGUSER=test PGDATABASE=test
export ALERT_TEST_DIR="$work"
sudo() {
  printf '%s\n' "$@" > "$ALERT_TEST_DIR/arguments"
  cat > "$ALERT_TEST_DIR/sql"
  return "${ALERT_TEST_FAILURE:-0}"
}
export -f sudo
# 只加载函数定义，绝不执行备份主流程。
source <(sed -n '/^record_backup_alert() {/,/^}/p' "$ROOT/database/scripts/scheduled-business-backup.sh")
record_backup_alert backup_test "包含'单引号的告警" '{"stage":"mount_check"}'
grep -Fx "summary=包含'单引号的告警" "$work/arguments"
grep -Fx 'detail={"stage":"mount_check"}' "$work/arguments"
grep -F "values (:'alert_type','critical',:'summary',:'detail'::jsonb)" "$work/sql"
record_backup_alert backup_test 默认详情
grep -Fx 'detail={}' "$work/arguments"
ALERT_TEST_FAILURE=1 record_backup_alert backup_test 写入失败 2> "$work/error"
grep -F '备份告警未写入数据库' "$work/error"
echo 'PASS: JSON 参数、单引号、默认详情和告警写入失败日志'
