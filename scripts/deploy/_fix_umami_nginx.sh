#!/bin/bash
set -e
CONF=/etc/nginx/sites-available/qingyu-web
echo "=== backup ==="
sudo cp $CONF $CONF.bak.$(date +%Y%m%d%H%M)
echo "=== current umami block ==="
sudo grep -n -A 7 "location /umami" $CONF
echo "=== fix: add trailing slash to proxy_pass ==="
# 把 /umami/ 段里的 proxy_pass http://127.0.0.1:3000; 改成 proxy_pass http://127.0.0.1:3000/;
# 用 awk 精确定位 location /umami 块
sudo awk '
/location \/umami\// { in_umami=1 }
in_umami && /proxy_pass http:\/\/127\.0\.0\.1:3000;/ {
    sub(/proxy_pass http:\/\/127\.0\.0\.1:3000;/, "proxy_pass http://127.0.0.1:3000/;")
    in_umami=0
}
{ print }
' $CONF | sudo tee $CONF.new > /dev/null
sudo mv $CONF.new $CONF
echo "=== new umami block ==="
sudo grep -n -A 7 "location /umami" $CONF
echo "=== nginx test ==="
sudo nginx -t
echo "=== reload ==="
sudo systemctl reload nginx
echo "=== verify ==="
sleep 1
curl -s -o /dev/null -w "GET /umami/script.js: %{http_code}\n" http://127.0.0.1/umami/script.js
curl -s -o /dev/null -w "GET /umami/api/heartbeat: %{http_code}\n" http://127.0.0.1/umami/api/heartbeat
echo "NGINX_FIX_DONE"
