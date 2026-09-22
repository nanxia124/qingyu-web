echo "=== all appwrite containers ==="
sudo docker ps -a --filter "name=appwrite" --format "table {{.Names}}\t{{.Status}}\t{{.Image}}" 2>&1 | head -40
echo "=== exited containers ==="
sudo docker ps -a --filter "name=appwrite" --filter "status=exited" --format "{{.Names}} {{.Status}}" 2>&1
