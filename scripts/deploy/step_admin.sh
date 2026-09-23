API=http://127.0.0.1/v1
ADMIN_EMAIL="admin@qingyu.local"
ADMIN_PASS="Qingyu$(openssl rand -hex 8)2026!"

echo "=== check setup status ==="
curl -s -H "X-Appwrite-Project: console" "$API/account" 2>&1 | head -c 300
echo ""
echo "=== create admin account (first-run setup) ==="
curl -s -X POST "$API/account" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: console" \
  -d "{\"userId\":\"admin\",\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\",\"name\":\"Admin\"}" 2>&1 | head -c 500
echo ""
echo "=== ADMIN CREATED (save these!) ==="
echo "EMAIL=$ADMIN_EMAIL"
echo "PASS=$ADMIN_PASS"
