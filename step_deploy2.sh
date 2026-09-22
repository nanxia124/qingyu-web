set -e
TS=$(date +%Y%m%d%H%M%S)
echo "=== backup old site ==="
sudo cp -r /var/www/qingyu-web /var/www/qingyu-web.bak.$TS
echo "backup: /var/www/qingyu-web.bak.$TS"
echo "=== deploy new ==="
sudo rm -rf /var/www/qingyu-web/*
sudo unzip -q -o /tmp/qingyu-web-dist.zip -d /var/www/qingyu-web
sudo chown -R www-data:www-data /var/www/qingyu-web
echo "=== verify ==="
ls /var/www/qingyu-web/
grep -o 'index-[A-Za-z0-9_-]*\.js' /var/www/qingyu-web/index.html | head -1
echo "=== test frontend ==="
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1/
curl -s http://127.0.0.1/ | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1
