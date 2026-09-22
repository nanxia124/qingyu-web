cd ~/appwrite
echo "=== starting stack ==="
sudo docker compose up -d 2>&1 | tail -40
echo "=== UP exit=$? ==="
echo "=== wait 20s for startup ==="
sleep 20
echo "=== container status ==="
sudo docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>&1 | head -40
