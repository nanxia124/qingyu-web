#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' '此旧脚本已停用：它会覆盖当前生产 Nginx 配置。请使用仓库当前部署流程。' >&2
exit 1