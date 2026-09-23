cd ~/appwrite
rm -f docker-compose.prod.yml env.example
chmod +x mongo-entrypoint.sh
echo "=== validate compose config (image tags) ==="
sudo docker compose config 2>&1 | grep -E 'image:|container_name:' | sort -u | head -40
echo "=== exit code: $? ==="
