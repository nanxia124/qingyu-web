cd ~/appwrite
echo "=== upgrade to 2.2.0 ==="
sed -i "s|^_APP_VERSION=.*|_APP_VERSION=2.2.0|" .env
grep _APP_VERSION .env
echo "=== pull 2.2.0 images ==="
sudo docker compose pull 2>&1 | tail -10
echo "=== recreate containers ==="
sudo docker compose up -d 2>&1 | tail -15
echo "=== wait 30s ==="
sleep 30
echo "=== appwrite health ==="
sudo docker inspect --format='{{.State.Health.Status}}' appwrite 2>/dev/null || echo "no healthcheck yet"
echo "=== version check ==="
curl -s http://127.0.0.1:8080/v1/health/version
echo ""
echo "=== memory ==="
free -h | head -2
