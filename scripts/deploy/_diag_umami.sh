#!/bin/bash
echo "=== umami container status ==="
sudo docker ps -a --filter name=umami --format "{{.Names}} {{.Status}} {{.Ports}}"
echo "=== umami container logs (last 15) ==="
sudo docker logs umami --tail 15 2>&1
echo "=== nginx umami config ==="
grep -A 8 "location /umami" /etc/nginx/sites-enabled/qingyu-web
echo "=== test direct umami from localhost:3000 ==="
curl -s -o /dev/null -w "direct 3000: %{http_code}\n" http://127.0.0.1:3000/umami/script.js
curl -s -o /dev/null -w "direct 3000 root: %{http_code}\n" http://127.0.0.1:3000/
echo "=== test via nginx ==="
curl -s -o /dev/null -w "nginx /umami/script.js: %{http_code}\n" http://127.0.0.1/umami/script.js
curl -s -o /dev/null -w "nginx /umami/: %{http_code}\n" http://127.0.0.1/umami/
echo "DIAG_DONE"
