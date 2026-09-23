echo "=== re-test /v1/health/version through nginx ==="
curl -s -i http://127.0.0.1/v1/health/version 2>&1 | head -20
echo ""
echo "=== curl with explicit Host header ==="
curl -s -H "Host: 43.160.249.6" http://127.0.0.1/v1/health/version
echo ""
echo "=== direct to appwrite container ==="
curl -s http://127.0.0.1:8080/v1/health/version
echo ""
echo "=== check nginx error log ==="
sudo tail -5 /var/log/nginx/error.log 2>/dev/null
