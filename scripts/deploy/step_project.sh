umask 077
API=http://127.0.0.1/v1
JAR=/tmp/appwrite_cookies.txt
EMAIL="admin@qingyu.local"
export APPWRITE_ADMIN_PASSWORD EMAIL
: "${APPWRITE_ADMIN_PASSWORD:?请通过安全环境变量设置 APPWRITE_ADMIN_PASSWORD}"

echo "=== login as admin ==="
python3 -c 'import json,os; print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["APPWRITE_ADMIN_PASSWORD"]}))' | curl -s -X POST "$API/account/sessions/email" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: console" \
  -c "$JAR" \
  --data-binary @- 2>&1 | head -c 300
echo ""
echo "=== create project qingyu ==="
curl -s -X POST "$API/projects" \
  -H "Content-Type: application/json" \
  -H "X-Appwrite-Project: console" \
  -b "$JAR" \
  -d '{"projectId":"qingyu","name":"轻域AI Qingyu","region":"default"}' 2>&1 | head -c 500
echo ""
echo "=== list projects ==="
curl -s -H "X-Appwrite-Project: console" -b "$JAR" "$API/projects" 2>&1 | python3 -c "import sys,json; d=json.load(sys.stdin); [print(p['\$id'], p.get('name','')) for p in d.get('projects',[])]" 2>/dev/null || echo "parse fail"
