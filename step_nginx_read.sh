echo "=== current nginx site config ==="
cat /etc/nginx/sites-enabled/qingyu-web
echo "=== test external access to appwrite via 8080 ==="
curl -s http://43.160.249.6:8080/v1/health/version
echo ""
