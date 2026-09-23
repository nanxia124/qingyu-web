#!/bin/bash
set -e
TS=$(date +%Y%m%d%H%M)
echo "=== backup ==="
sudo cp -r /var/www/qingyu-web /var/www/qingyu-web.bak.$TS
echo "=== clean old assets ==="
sudo rm -rf /var/www/qingyu-web/assets
echo "=== unzip fresh build ==="
sudo unzip -o /home/ubuntu/qingyu-web-dist.zip -d /var/www/qingyu-web | tail -5
echo "=== chown ==="
sudo chown -R www-data:www-data /var/www/qingyu-web
echo "=== nginx test ==="
sudo nginx -t
echo "=== reload ==="
sudo systemctl reload nginx
echo "=== verify umami script path in index.html ==="
grep -o 'src="[^"]*script.js"' /var/www/qingyu-web/index.html
echo "=== check no hardcoded IP in built JS ==="
grep -rl "43.160.249.6" /var/www/qingyu-web/assets/*.js 2>/dev/null && echo "WARNING: old IP still present" || echo "OK: no hardcoded IP in bundle"
echo "=== homepage HTTP check ==="
curl -s -o /dev/null -w "homepage: %{http_code}\n" http://127.0.0.1/
echo "=== /umami/script.js check ==="
curl -s -o /dev/null -w "umami script: %{http_code}\n" http://127.0.0.1/umami/script.js
echo "=== /v1 health check ==="
curl -s -o /dev/null -w "appwrite v1: %{http_code}\n" http://127.0.0.1/v1/health/version
echo "=== list index.html script tag ==="
grep -o 'src="[^"]*"' /var/www/qingyu-web/index.html
echo "DEPLOY_DONE"
