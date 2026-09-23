cd ~/qingyu-api
sudo systemctl restart qingyu-api
sleep 2
echo "=== service status ==="
sudo systemctl is-active qingyu-api
echo "=== test login returns JWT ==="
TOKEN=$(curl -s -X POST http://127.0.0.1/api/admin/login -H "Content-Type: application/json" -d '{"username":"admin","password":"QingyuAdmin2026!"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
echo "token starts: ${TOKEN:0:20}..."
echo "token parts: $(echo $TOKEN | tr '.' ' ' | wc -w)"
