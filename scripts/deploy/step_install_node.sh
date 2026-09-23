echo "=== install node 20 via nodesource ==="
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - 2>&1 | tail -5
sudo apt-get install -y nodejs 2>&1 | tail -5
echo "=== verify ==="
node --version
npm --version
echo "=== start api server ==="
cd ~/qingyu-api
pkill -f "node.*api-server.mjs" 2>/dev/null || true
sleep 1
nohup node api-server.mjs > server.log 2>&1 &
echo "PID: $!"
sleep 2
cat server.log
echo "=== test ==="
curl -s http://127.0.0.1:3001/api/config/public
echo ""
