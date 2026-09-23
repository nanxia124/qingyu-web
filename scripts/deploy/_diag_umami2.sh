#!/bin/bash
echo "=== test script.js at root ==="
curl -s -o /dev/null -w "GET /script.js: %{http_code}\n" http://127.0.0.1:3000/script.js
echo "=== test umami api send ==="
curl -s -o /dev/null -w "GET /api/heartbeat: %{http_code}\n" http://127.0.0.1:3000/api/heartbeat
echo "=== umami env in container ==="
sudo docker exec umami env | grep -i base_path
echo "=== umami version ==="
sudo docker exec umami cat package.json 2>/dev/null | grep version | head -1 || echo "no package.json"
echo "=== test with proxy_strip path (simulate nginx with trailing slash) ==="
curl -s -o /dev/null -w "GET /script.js via strip: %{http_code}\n" http://127.0.0.1:3000/script.js
echo "DIAG2_DONE"
