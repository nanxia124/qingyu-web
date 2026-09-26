echo "=== verify config has /api/ block ==="
grep -n "location /api/" /etc/nginx/sites-available/qingyu-web
echo "=== restart nginx (not reload) ==="
sudo systemctl restart nginx
sleep 2
echo "=== test /api/config/public ==="
curl -s http://127.0.0.1/api/config/public
echo ""
