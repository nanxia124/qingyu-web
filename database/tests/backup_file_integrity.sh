#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
verify="$SCRIPT_DIR/../scripts/verify-backup-file.sh"
command -v age >/dev/null || { echo 'SKIP: age 未安装，无法执行加密完整性测试' >&2; exit 77; }
command -v age-keygen >/dev/null || { echo 'SKIP: age-keygen 未安装，无法执行加密完整性测试' >&2; exit 77; }
fixture="$(mktemp -d)"
trap 'rm -rf -- "$fixture"' EXIT
mkdir "$fixture/source" "$fixture/copy"
printf '数据库备份测试内容\n' > "$fixture/source/backup.dump"
sha256sum "$fixture/source/backup.dump" > "$fixture/source/backup.dump.sha256"
age-keygen -o "$fixture/identity.txt" >/dev/null 2>&1
chmod 600 "$fixture/identity.txt"
recipient="$(age-keygen -y "$fixture/identity.txt")"
age -r "$recipient" -o "$fixture/source/backup.dump.age" "$fixture/source/backup.dump"
sha256sum "$fixture/source/backup.dump.age" > "$fixture/source/backup.dump.age.sha256"
cp "$fixture/source/backup.dump.age" "$fixture/source/backup.dump.age.sha256" "$fixture/copy/"
"$SCRIPT_DIR/../scripts/verify-backup-file.sh" "$fixture/copy/backup.dump.age"
age -d -i "$fixture/identity.txt" "$fixture/source/backup.dump.age" | cmp - "$fixture/source/backup.dump"
age-keygen -o "$fixture/wrong-identity.txt" >/dev/null 2>&1
if age -d -i "$fixture/wrong-identity.txt" "$fixture/source/backup.dump.age" >/dev/null 2>&1; then
  echo 'FAIL: 错误私钥意外解密成功' >&2; exit 1
fi
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
echo 'PASS: age 加密/解密，以及副本完好、损坏、原件不存在、无效摘要和缺失摘要均按预期处理'
