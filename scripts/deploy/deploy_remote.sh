set -e
TS=$(date +%Y%m%d%H%M)
echo "=== backup to /var/www/qingyu-web.bak.$TS ==="
sudo cp -r /var/www/qingyu-web /var/www/qingyu-web.bak.$TS
echo "=== unzip ==="
sudo unzip -o /home/ubuntu/qingyu-web-dist.zip -d /var/www/qingyu-web | tail -3
echo "=== chown ==="
sudo chown -R www-data:www-data /var/www/qingyu-web
echo "=== nginx test ==="
sudo nginx -t
echo "=== reload ==="
sudo systemctl reload nginx
echo "=== new index.html ==="
cat /var/www/qingyu-web/index.html
echo "DEPLOY_DONE"
