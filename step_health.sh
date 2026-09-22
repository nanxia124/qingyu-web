echo "=== wait for appwrite health ==="
for i in $(seq 1 18); do
  STATUS=$(sudo docker inspect --format='{{.State.Health.Status}}' appwrite 2>/dev/null)
  echo "attempt $i: appwrite health = $STATUS"
  if [ "$STATUS" = "healthy" ]; then break; fi
  sleep 10
done
echo "=== test API version endpoint ==="
curl -s -H "Host: 43.160.249.6" http://localhost:8080/v1/health/version
echo ""
echo "=== test without host header ==="
curl -s http://localhost:8080/v1/health/version
echo ""
echo "=== memory usage ==="
free -h
echo "=== any restarting/dead containers? ==="
sudo docker compose ps --format "{{.Name}} {{.Status}}" 2>&1 | grep -iE "restart|exited|dead|unhealthy" || echo "none unhealthy"
