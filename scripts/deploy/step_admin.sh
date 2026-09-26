API=http://127.0.0.1/v1
ADMIN_EMAIL="admin@qingyu.local"
export APPWRITE_ADMIN_PASSWORD ADMIN_EMAIL
: "${APPWRITE_ADMIN_PASSWORD:?请通过安全环境变量设置 APPWRITE_ADMIN_PASSWORD}"

echo "=== check setup status ==="
curl -s -H "X-Appwrite-Project: console" "$API/account" 2>&1 | head -c 300
echo ""
echo "=== create admin account (first-run setup) ==="
python3 -c 'import json,os; print(json.dumps({"userId":"admin","email":os.environ["ADMIN_EMAIL"],"password":os.environ["APPWRITE_ADMIN_PASSWORD"],"name":"Admin"}))' | curl -s -X POST "$API/account" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: console" \
  --data-binary @- 2>&1 | head -c 500
echo ""
echo "=== ADMIN CREATED (save these!) ==="
echo "EMAIL=$ADMIN_EMAIL"
