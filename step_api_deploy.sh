set -e
echo "=== check node ==="
which node && node --version || echo "NO NODE"

echo "=== upload server file ==="
# (file is uploaded via scp separately)

echo "=== create data dir ==="
mkdir -p ~/qingyu-api/api-data

echo "=== kill old instance if any ==="
pkill -f "node.*api-server.mjs" 2>/dev/null || true
sleep 1

echo "=== start server (background, nohup) ==="
cd ~/qingyu-api
nohup node api-server.mjs > server.log 2>&1 &
echo "PID: $!"
sleep 2

echo "=== server log ==="
cat server.log

echo "=== test health ==="
curl -s http://127.0.0.1:3001/api/config/public
echo ""
echo "=== test admin login ==="
curl -s -X POST http://127.0.0.1:3001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"QingyuAdmin2026!"}'
echo ""
