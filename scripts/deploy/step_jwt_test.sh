cd ~/qingyu-api
sudo systemctl restart qingyu-api
sleep 2
echo "=== service status ==="
sudo systemctl is-active qingyu-api
