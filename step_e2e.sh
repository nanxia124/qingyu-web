echo "=== public API health ==="
curl -s http://43.160.249.6/v1/health/version
echo ""
echo "=== test account endpoint (should return 401, not CORS error) ==="
curl -s -i -H "X-Appwrite-Project: qingyu" http://43.160.249.6/v1/account 2>&1 | head -15
echo ""
echo "=== appwrite container health ==="
sudo docker inspect --format='{{.State.Health.Status}}' appwrite
