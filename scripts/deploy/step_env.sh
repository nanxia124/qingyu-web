echo "=== docker version ==="
sudo docker version
echo "=== docker compose version ==="
sudo docker compose version 2>/dev/null || sudo docker-compose version 2>/dev/null || echo "no compose plugin"
echo "=== docker service status ==="
sudo systemctl is-active docker
echo "=== free mem/disk ==="
free -h
df -h / | tail -1
echo "=== existing appwrite dir ==="
ls -la /opt/appwrite 2>/dev/null || echo "no /opt/appwrite"
ls -la ~/appwrite 2>/dev/null || echo "no ~/appwrite"
