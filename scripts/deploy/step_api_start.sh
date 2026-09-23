cd ~/qingyu-api
pkill -f "node.*api-server.mjs" 2>/dev/null || true
sleep 1
nohup node api-server.mjs > server.log 2>&1 &
echo "PID: $!"
sleep 2
echo "=== log ==="
cat server.log
echo "=== test config/public ==="
curl -s http://127.0.0.1:3001/api/config/public
echo ""
echo "=== test admin login ==="
curl -s -X POST http://127.0.0.1:3001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"QingyuAdmin2026!"}'
echo ""
