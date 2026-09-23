#!/usr/bin/env bash
set -Eeuo pipefail

backup_file="${1:?用法：verify-backup-file.sh /path/to/file.dump}"
checksum_file="${backup_file}.sha256"
test -f "$backup_file" || { echo "backup file not found: $backup_file" >&2; exit 1; }
test -f "$checksum_file" || { echo "checksum file not found: $checksum_file" >&2; exit 1; }
sha256sum -c "$checksum_file"
echo "backup checksum verified: $backup_file"
