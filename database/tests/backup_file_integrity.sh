#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
verify="$SCRIPT_DIR/../scripts/verify-backup-file.sh"
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/source" "$fixture/copy"
printf '数据库备份测试内容\n' > "$fixture/source/backup.dump"
sha256sum "$fixture/source/backup.dump" > "$fixture/source/backup.dump.sha256"
cp "$fixture/source/backup.dump" "$fixture/source/backup.dump.sha256" "$fixture/copy/"
bash "$verify" "$fixture/copy/backup.dump"
printf '已损坏\n' >> "$fixture/copy/backup.dump"
if bash "$verify" "$fixture/copy/backup.dump"; then
  echo 'FAIL: 原件完好时错误接受了损坏副本' >&2; exit 1
fi
cp "$fixture/source/backup.dump" "$fixture/copy/backup.dump"
rm "$fixture/source/backup.dump"
bash "$verify" "$fixture/copy/backup.dump"
printf '无效摘要\n' > "$fixture/copy/backup.dump.sha256"
if bash "$verify" "$fixture/copy/backup.dump"; then
  echo 'FAIL: 接受了无效摘要' >&2; exit 1
fi
rm "$fixture/copy/backup.dump.sha256"
if bash "$verify" "$fixture/copy/backup.dump"; then
  echo 'FAIL: 没有摘要却校验成功' >&2; exit 1
fi
echo 'PASS: 副本完好、损坏、原件不存在、无效摘要和缺失摘要均按预期处理'
