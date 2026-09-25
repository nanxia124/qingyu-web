echo "=== failed containers ==="
sudo docker compose ps --format "{{.Name}} {{.Status}}" 2>&1 | grep -iE "exited|restart|dead|created" || echo "none in bad state"
echo "=== all container count ==="
sudo docker compose ps --format "{{.Name}}" 2>&1 | wc -l
echo "=== running count ==="
sudo docker compose ps --format "{{.Status}}" 2>&1 | grep -c "Up"
