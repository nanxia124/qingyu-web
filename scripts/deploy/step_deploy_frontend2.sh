set -e
cd /var/www/qingyu-web
# backup
sudo cp index.html index.html.bak.$(date +%s) 2>/dev/null || true
# extract new build
sudo unzip -o /tmp/qingyu-web-dist.zip -d /var/www/qingyu-web > /dev/null
echo "=== deployed files ==="
ls -la /var/www/qingyu-web/index.html
ls /var/www/qingyu-web/assets/ | head -10
echo "=== test homepage ==="
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/
echo ""
echo "=== test admin route returns SPA (not 404) ==="
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/admin-secret-8f3k2x7z
echo ""
