#!/usr/bin/env bash
set -Eeuo pipefail

backup_file="${1:?用法：verify-backup-file.sh /path/to/file.dump}"
checksum_file="${backup_file}.sha256"
test -f "$backup_file" || { echo "backup file not found: $backup_file" >&2; exit 1; }
test -f "$checksum_file" || { echo "checksum file not found: $checksum_file" >&2; exit 1; }
# 只读取预期摘要，绝不跟随校验文件里的旧路径，否则副本损坏时可能校验了原件。
mapfile -t checksum_lines < "$checksum_file"
if [[ ${#checksum_lines[@]} -ne 1 || ! ${checksum_lines[0]} =~ ^([[:xdigit:]]{64})[[:space:]] ]]; then
  echo "invalid checksum file: $checksum_file" >&2
  exit 1
fi
expected="${BASH_REMATCH[1],,}"
actual="$(sha256sum -- "$backup_file")"
actual="${actual:0:64}"
if [[ "$actual" != "$expected" ]]; then
  echo "backup checksum mismatch: $backup_file" >&2
  exit 1
fi
echo "backup checksum verified: $backup_file"
